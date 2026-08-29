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
    return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  }
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return (
    0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a)
  );
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}

/**
 * A discrete distribution over INTEGER points, as a dense array indexed from `min`.
 *
 * FPL points are integers over a small range, so the exact object is cheap. Everything above this
 * line computes a mean; this is the machinery for keeping the whole shape, which is what an honest
 * "how likely is a blank" or "how likely is a haul" needs (B-017).
 */
export interface PointsPmf {
  /** the points value `p[0]` corresponds to; negative, because goals conceded and cards are */
  min: number;
  /** probabilities, summing to 1 */
  p: number[];
}

/** A point mass at one value — the identity for convolution. */
export function pmfAt(value: number): PointsPmf {
  return { min: value, p: [1] };
}

/** Two independent contributions added: the discrete convolution of their distributions. */
export function convolve(a: PointsPmf, b: PointsPmf): PointsPmf {
  const p = new Array<number>(a.p.length + b.p.length - 1).fill(0);
  for (let i = 0; i < a.p.length; i++) {
    if (a.p[i] === 0) continue;
    for (let j = 0; j < b.p.length; j++) {
      if (b.p[j] === 0) continue;
      p[i + j] += a.p[i] * b.p[j];
    }
  }
  return { min: a.min + b.min, p };
}

/**
 * A count with a fixed points value per unit, as a PMF — goals, assists.
 *
 * Truncated at `maxCount` and the remaining tail folded into the top bin. Poisson tails past four
 * goals are of the order 1e-5 for any realistic lambda, and folding rather than dropping keeps the
 * distribution normalised, which is what the test asserts.
 */
export function countPmf(
  lambda: number,
  pointsPerUnit: number,
  maxCount = 5,
): PointsPmf {
  if (pointsPerUnit === 0 || lambda <= 0) return pmfAt(0);
  const probs: number[] = [];
  let below = 0;
  for (let k = 0; k < maxCount; k++) {
    const q = poissonPmf(lambda, k);
    probs.push(q);
    below += q;
  }
  probs.push(Math.max(0, 1 - below));

  // Points per unit may be negative (own goals) or a multi-point step (a goal). The grid is laid out
  // in POINTS, so the stride between counts is |pointsPerUnit| and the origin flips when it is
  // negative — writing this as a positive-only helper is how a negative term silently becomes zero.
  const stride = Math.abs(pointsPerUnit);
  const span = stride * maxCount;
  const p = new Array<number>(span + 1).fill(0);
  for (let k = 0; k <= maxCount; k++) {
    const idx = pointsPerUnit > 0 ? k * stride : span - k * stride;
    p[idx] += probs[k];
  }
  return { min: pointsPerUnit > 0 ? 0 : -span, p };
}

/**
 * `⌊X / d⌋` scored at a fixed points value — the saves and goals-conceded rules, as a distribution.
 *
 * The same identity `expectedFloorDiv` uses, kept as a shape instead of collapsed to its mean.
 */
export function floorDivPmf(
  lambda: number,
  d: number,
  pointsPerUnit: number,
  maxUnits = 4,
): PointsPmf {
  if (pointsPerUnit === 0 || lambda <= 0 || d <= 0) return pmfAt(0);
  const probs: number[] = [];
  let below = 0;
  for (let m = 0; m < maxUnits; m++) {
    // P(⌊X/d⌋ = m) = P(X >= m·d) − P(X >= (m+1)·d)
    const q = Math.max(
      0,
      poissonTail(lambda, m * d) - poissonTail(lambda, (m + 1) * d),
    );
    probs.push(q);
    below += q;
  }
  probs.push(Math.max(0, 1 - below));

  const stride = Math.abs(pointsPerUnit);
  const span = stride * maxUnits;
  const p = new Array<number>(span + 1).fill(0);
  for (let m = 0; m <= maxUnits; m++) {
    const idx = pointsPerUnit > 0 ? m * stride : span - m * stride;
    p[idx] += probs[m];
  }
  return { min: pointsPerUnit > 0 ? 0 : -span, p };
}

/** A yes/no event worth `points` when it happens. */
export function bernoulliPmf(probability: number, points: number): PointsPmf {
  const q = Math.max(0, Math.min(1, probability));
  if (points === 0) return pmfAt(0);
  if (points > 0) {
    const p = new Array<number>(points + 1).fill(0);
    p[0] = 1 - q;
    p[points] = q;
    return { min: 0, p };
  }
  const span = -points;
  const p = new Array<number>(span + 1).fill(0);
  p[0] = q;
  p[span] = 1 - q;
  return { min: points, p };
}

/**
 * Bonus, as the {0, 1, 2, 3} distribution it actually is.
 *
 * `pAny` is P(receiving any bonus at all); given that, the three recipients of a match take 3, 2 and
 * 1, so an award is close to uniform over them. Modelling bonus as a mean would give a player a
 * guaranteed 0.4 points, which is not a thing that can happen and which understates the spread.
 */
/**
 * The bonus distribution when the three awards have their OWN probabilities (B-041, plan 028 task 4).
 *
 * `bonusPmf` below splits `P(any)` evenly across 3, 2 and 1 because the incumbent term only knows a
 * total. The rank model knows which award: a player who leads a match on BPS is far more likely to
 * take the three than the one, and an even split understates his upside and overstates his floor.
 * The mean of this pmf is `3·first + 2·second + third` exactly, which is what keeps
 * `distribution.mean` equal to `ep`.
 */
export function bonusRankPmf(
  first: number,
  second: number,
  third: number,
  pointsPerBonus: number,
): PointsPmf {
  const clamp = (x: number) => Math.max(0, Math.min(1, x));
  const p3 = clamp(first);
  const p2 = clamp(second);
  const p1 = clamp(third);
  const span = 3 * Math.max(1, pointsPerBonus);
  const p = new Array<number>(span + 1).fill(0);
  p[0] = Math.max(0, 1 - p3 - p2 - p1);
  p[1 * pointsPerBonus] += p1;
  p[2 * pointsPerBonus] += p2;
  p[3 * pointsPerBonus] += p3;
  return { min: 0, p };
}

export function bonusPmf(pAny: number, pointsPerBonus: number): PointsPmf {
  const q = Math.max(0, Math.min(1, pAny));
  const span = 3 * Math.max(1, pointsPerBonus);
  const p = new Array<number>(span + 1).fill(0);
  p[0] = 1 - q;
  for (const award of [1, 2, 3]) {
    p[award * pointsPerBonus] += q / 3;
  }
  return { min: 0, p };
}

/** Mix distributions by weight — the minutes states, which is the one correlation that matters. */
export function mixPmf(parts: { weight: number; pmf: PointsPmf }[]): PointsPmf {
  const live = parts.filter((x) => x.weight > 0);
  if (live.length === 0) return pmfAt(0);
  const min = Math.min(...live.map((x) => x.pmf.min));
  const max = Math.max(...live.map((x) => x.pmf.min + x.pmf.p.length - 1));
  const p = new Array<number>(max - min + 1).fill(0);
  for (const { weight, pmf } of live) {
    for (let i = 0; i < pmf.p.length; i++) {
      p[pmf.min + i - min] += weight * pmf.p[i];
    }
  }
  return { min, p };
}

export interface PmfSummary {
  mean: number;
  variance: number;
  sd: number;
  /** P(2 points or fewer) — the appearance and nothing else, which is what a blank means */
  pBlank: number;
  /** P(10 points or more) */
  pHaul: number;
  /** should be 1; carried so a caller can assert it rather than trust it */
  total: number;
}

/** How few points count as a blank, and how many as a haul. Both are the conventional readings. */
export const BLANK_AT_OR_BELOW = 2;
export const HAUL_AT_OR_ABOVE = 10;

export function summarise(pmf: PointsPmf): PmfSummary {
  let total = 0;
  let mean = 0;
  let second = 0;
  let pBlank = 0;
  let pHaul = 0;
  for (let i = 0; i < pmf.p.length; i++) {
    const q = pmf.p[i];
    if (q === 0) continue;
    const value = pmf.min + i;
    total += q;
    mean += q * value;
    second += q * value * value;
    if (value <= BLANK_AT_OR_BELOW) pBlank += q;
    if (value >= HAUL_AT_OR_ABOVE) pHaul += q;
  }
  const variance = Math.max(0, second - mean * mean);
  return { mean, variance, sd: Math.sqrt(variance), pBlank, pHaul, total };
}
