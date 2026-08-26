/**
 * Scoring a *probability* rather than a mean.
 *
 * `metrics.ts` answers "how far off was the number". This file answers the question that one cannot:
 * **when the model says 30%, does it happen 30% of the time?** A model can carry a respectable MAE
 * on total points while every probability inside it is the wrong shape, because the components are
 * summed before anything looks at them.
 *
 * Two instruments, and the second exists because the first is easy to misread.
 *
 * - **A reliability curve** — bin by predicted probability, and compare each bin's mean prediction
 *   with the share of that bin that actually happened. Perfect calibration is the diagonal.
 * - **A Brier score with Murphy's decomposition**, `BS = reliability − resolution + uncertainty`.
 *   The raw Brier score alone is a trap for rare events: predicting "never" for a 2% event scores
 *   0.0196, which looks excellent and is worthless. Splitting it says which part is skill:
 *   *reliability* is the calibration error (lower is better, 0 is perfect), *resolution* is how far
 *   the model moves away from the base rate when it is right (higher is better), and *uncertainty*
 *   is the base rate's own variance, which belongs to the event and not to the model. Every table
 *   here therefore also carries `baseRate` and `n`, so a component cannot be praised for a number
 *   that a constant predictor would have matched.
 */

export interface BinaryPair {
  /** the model's probability, 0..1 */
  p: number;
  /** what happened: 1 or 0 */
  y: number;
}

export interface ReliabilityBin {
  lower: number;
  upper: number;
  n: number;
  meanPredicted: number;
  observedRate: number;
}

export interface BrierScore {
  n: number;
  /** mean((p − y)²) */
  score: number;
  /** calibration error — 0 is perfect. This is the number B-013 was opened to produce. */
  reliability: number;
  /** how much the model separates outcomes from the base rate — 0 means it says nothing */
  resolution: number;
  /** base-rate variance ȳ(1−ȳ); belongs to the event, not the model */
  uncertainty: number;
  /** 1 − score/uncertainty. Positive means better than always predicting the base rate. */
  skillScore: number;
  baseRate: number;
  meanPredicted: number;
}

/** Ten fixed bins. Fixed rather than quantile, for the reason `calibrationCurve` gives. */
export const RELIABILITY_EDGES = [
  0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9, 1.0000001,
];

export function reliabilityCurve(
  pairs: BinaryPair[],
  edges: number[] = RELIABILITY_EDGES,
): ReliabilityBin[] {
  const bins: ReliabilityBin[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lower = edges[i];
    const upper = edges[i + 1];
    const inBin = pairs.filter((r) => r.p >= lower && r.p < upper);
    bins.push({
      lower,
      upper: Math.min(upper, 1),
      n: inBin.length,
      meanPredicted: mean(inBin.map((r) => r.p)),
      observedRate: mean(inBin.map((r) => r.y)),
    });
  }
  return bins;
}

/**
 * Brier score and its three-way decomposition, over the same bins the curve uses.
 *
 * The decomposition is exact only when it is computed over the binning, so the identity
 * `score ≈ reliability − resolution + uncertainty` holds to binning error and no further — the tests
 * assert it to a tolerance rather than to equality, which is the honest claim.
 */
export function brierScore(
  pairs: BinaryPair[],
  edges: number[] = RELIABILITY_EDGES,
): BrierScore {
  const n = pairs.length;
  if (n === 0) {
    return {
      n: 0,
      score: 0,
      reliability: 0,
      resolution: 0,
      uncertainty: 0,
      skillScore: 0,
      baseRate: 0,
      meanPredicted: 0,
    };
  }

  const baseRate = mean(pairs.map((r) => r.y));
  const score = mean(pairs.map((r) => (r.p - r.y) ** 2));
  const uncertainty = baseRate * (1 - baseRate);

  let reliability = 0;
  let resolution = 0;
  for (const bin of reliabilityCurve(pairs, edges)) {
    if (bin.n === 0) continue;
    const w = bin.n / n;
    reliability += w * (bin.meanPredicted - bin.observedRate) ** 2;
    resolution += w * (bin.observedRate - baseRate) ** 2;
  }

  return {
    n,
    score,
    reliability,
    resolution,
    uncertainty,
    skillScore: uncertainty > 0 ? 1 - score / uncertainty : 0,
    baseRate,
    meanPredicted: mean(pairs.map((r) => r.p)),
  };
}

export interface CountPair {
  predicted: number;
  actual: number;
}

export interface DecileRow {
  decile: number;
  n: number;
  meanPredicted: number;
  meanActual: number;
}

/**
 * The count terms, by decile of the model's own prediction.
 *
 * Deciles rather than fixed edges here, because a count term's scale is not known in advance — a
 * defender's expected goals live between 0 and 0.2 and a keeper's expected saves between 0 and 6, so
 * one fixed set of edges would put every defender in one bucket and say nothing.
 *
 * Ties are kept together: a term where 80% of rows predict exactly the same number produces fewer
 * than ten populated deciles, which is itself the finding and must not be hidden by splitting a tie
 * across a boundary.
 */
export function decileTable(pairs: CountPair[], buckets = 10): DecileRow[] {
  if (pairs.length === 0) return [];
  const sorted = [...pairs].sort((a, b) => a.predicted - b.predicted);

  const groups: CountPair[][] = [];
  let i = 0;
  for (let b = 0; b < buckets && i < sorted.length; b++) {
    const target = Math.round(((b + 1) * sorted.length) / buckets);
    const g: CountPair[] = [];
    while (i < target && i < sorted.length) g.push(sorted[i++]);
    // Carry on past a tie rather than splitting it: two rows with the same prediction belong in the
    // same bucket, and a term where most rows predict one value must show as few populated buckets
    // rather than as a smooth curve manufactured by the boundary.
    while (
      i < sorted.length &&
      g.length > 0 &&
      sorted[i].predicted === g[g.length - 1].predicted
    ) {
      g.push(sorted[i++]);
    }
    if (g.length > 0) groups.push(g);
  }

  return groups.map((g, idx) => ({
    decile: idx + 1,
    n: g.length,
    meanPredicted: mean(g.map((r) => r.predicted)),
    meanActual: mean(g.map((r) => r.actual)),
  }));
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}
