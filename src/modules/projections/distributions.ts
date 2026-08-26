/**
 * Count distributions for the scoring rules that are NOT linear in the count.
 *
 * The defect this file exists to remove: **the expectation of a function is not the function of the
 * expectation.** FPL pays `floor(saves / 3)`, `floor(conceded / 2)`, and 2 points at a defensive
 * contribution threshold. v1 computed all three from the mean — `E[saves] / 3`, `E[gc] / 2`, and a
 * linear ramp toward the defcon threshold — which is a different number, and wrong in a direction that
 * matters:
 *
 * - A keeper facing 2.0 expected saves scores `2/3 = 0.67` points under the mean, but
 *   `E[floor(X/3)]` for Poisson(2) is ~0.32. Nearly double.
 * - The defcon ramp `(λ/threshold) × 0.7` is roughly linear in the rate, while the true tail
 *   probability is convex then saturating. Around and above the threshold the ramp **over-pays**, and
 *   the players sitting there are the high-rate premium defenders and midfielders — which is exactly
 *   the premium-head over-projection B-007 was opened to explain.
 *
 * Poisson is the right shape for these: independent-ish events accumulating over a match, no upper
 * bound that binds. It is an approximation — saves cluster, defensive actions come in spells — and the
 * fitted overdispersion in `fitted.ts` is where that is answered, not here.
 */

/** P(X = k) for X ~ Poisson(lambda), computed in logs so a large lambda cannot overflow. */
export function poissonPmf(lambda: number, k: number): number {
  if (lambda <= 0) return k === 0 ? 1 : 0;
  if (k < 0) return 0;
  return Math.exp(-lambda + k * Math.log(lambda) - logFactorial(k));
}

/** P(X >= k) — the tail a threshold rule actually asks about. */
export function poissonTail(lambda: number, k: number): number {
  if (k <= 0) return 1;
  if (lambda <= 0) return 0;
  let below = 0;
  for (let i = 0; i < k; i++) below += poissonPmf(lambda, i);
  return clamp01(1 - below);
}

/**
 * `E[floor(X / d)]` for X ~ Poisson(lambda) — the saves and goals-conceded rules.
 *
 * Summed as `Σ_{m>=1} P(X >= m·d)`, which is the identity `E[floor(X/d)] = Σ P(floor(X/d) >= m)`. The
 * cap is generous relative to any football count and the terms vanish fast.
 */
export function expectedFloorDiv(lambda: number, d: number): number {
  if (lambda <= 0 || d <= 0) return 0;
  let total = 0;
  for (let m = 1; m <= 40; m++) {
    const p = poissonTail(lambda, m * d);
    if (p < 1e-9) break;
    total += p;
  }
  return total;
}

/**
 * P(reaching a defensive-contribution threshold) from the expected count in the match.
 *
 * `dispersion` > 1 widens the distribution beyond Poisson: defensive actions are not independent —
 * a team under sustained pressure produces a cluster of them — so the real spread is wider than the
 * mean alone implies, which lifts the tail for players below the threshold and flattens it for those
 * above. It is a fitted number, defaulting to 1 (pure Poisson) so an unfitted caller gets the
 * conservative shape rather than a silent guess.
 */
export function thresholdProbability(
  expectedCount: number,
  threshold: number,
  dispersion = 1,
): number {
  if (threshold <= 0 || expectedCount <= 0) return 0;
  if (dispersion <= 1) return poissonTail(expectedCount, threshold);

  // Negative binomial with the same mean and variance = dispersion × mean. Parameterised by
  // (r, p) with mean = r(1-p)/p, so r = mean / (dispersion - 1) and p = 1 / dispersion.
  const r = expectedCount / (dispersion - 1);
  const p = 1 / dispersion;
  let below = 0;
  for (let k = 0; k < threshold; k++) below += negBinomialPmf(k, r, p);
  return clamp01(1 - below);
}

function negBinomialPmf(k: number, r: number, p: number): number {
  // log C(k+r-1, k) + r log p + k log(1-p), via log-gamma so r need not be an integer.
  const logC = logGamma(k + r) - logGamma(r) - logFactorial(k);
  return Math.exp(logC + r * Math.log(p) + k * Math.log(1 - p));
}

const LOG_FACTORIAL: number[] = [0];
function logFactorial(n: number): number {
  for (let i = LOG_FACTORIAL.length; i <= n; i++) {
    LOG_FACTORIAL[i] = LOG_FACTORIAL[i - 1] + Math.log(i);
  }
  return LOG_FACTORIAL[n];
}

/** Lanczos approximation — accurate well past the precision any of these terms needs. */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) {
    return (
      Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x)
    );
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
