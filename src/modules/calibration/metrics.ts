/**
 * Scoring a projection against what happened.
 *
 * Two different questions, and reporting only the first is how a model gets trusted for the wrong
 * reason:
 *
 *   - **Error** — how far off is a prediction, on average. MAE, RMSE, and bias. Bias is the one that
 *     names B-007's actual defect: a model that over-projects the premium head has a positive bias
 *     concentrated in the top price band, which a single MAE hides completely.
 *   - **Calibration** — when the model says 6 points, do those players average 6? A model can have a
 *     respectable MAE and still be systematically 40% high everywhere, and for a squad optimiser that
 *     is worse than noise, because every comparison it makes is skewed the same way.
 */

export interface Observation {
  predicted: number;
  actual: number;
  position: string;
  /** price in tenths, for the band split — the known defect is head-specific */
  value: number;
  season: string;
  round: number;
}

export interface ErrorStats {
  n: number;
  mae: number;
  rmse: number;
  /** mean(predicted − actual). Positive means the model pays too much. */
  bias: number;
  meanPredicted: number;
  meanActual: number;
}

export function errorStats(rows: Observation[]): ErrorStats {
  if (rows.length === 0) {
    return { n: 0, mae: 0, rmse: 0, bias: 0, meanPredicted: 0, meanActual: 0 };
  }
  let ae = 0;
  let se = 0;
  let bias = 0;
  let sp = 0;
  let sa = 0;
  for (const r of rows) {
    const d = r.predicted - r.actual;
    ae += Math.abs(d);
    se += d * d;
    bias += d;
    sp += r.predicted;
    sa += r.actual;
  }
  const n = rows.length;
  return {
    n,
    mae: ae / n,
    rmse: Math.sqrt(se / n),
    bias: bias / n,
    meanPredicted: sp / n,
    meanActual: sa / n,
  };
}

export interface CalibrationBucket {
  lower: number;
  upper: number;
  n: number;
  meanPredicted: number;
  meanActual: number;
}

/**
 * Bucket by predicted points and compare each bucket's mean prediction with its mean outcome.
 *
 * The buckets are fixed rather than quantile-based on purpose: quantile buckets move with the model,
 * so two models cannot be compared row for row, and a model that predicts everything as 2.0 gets a
 * flattering-looking curve.
 */
export function calibrationCurve(
  rows: Observation[],
  edges = [0, 1, 2, 3, 4, 5, 6, 8, 10, Infinity],
): CalibrationBucket[] {
  const buckets: CalibrationBucket[] = [];
  for (let i = 0; i < edges.length - 1; i++) {
    const lower = edges[i];
    const upper = edges[i + 1];
    const inBucket = rows.filter(
      (r) => r.predicted >= lower && r.predicted < upper,
    );
    buckets.push({
      lower,
      upper,
      n: inBucket.length,
      meanPredicted:
        inBucket.length > 0
          ? inBucket.reduce((s, r) => s + r.predicted, 0) / inBucket.length
          : 0,
      meanActual:
        inBucket.length > 0
          ? inBucket.reduce((s, r) => s + r.actual, 0) / inBucket.length
          : 0,
    });
  }
  return buckets;
}

/** Price bands in tenths — the top band is where the known over-projection lives. */
export const PRICE_BANDS: { label: string; min: number; max: number }[] = [
  { label: '≤ £5.0m', min: 0, max: 50 },
  { label: '£5.1–7.0m', min: 51, max: 70 },
  { label: '£7.1–9.0m', min: 71, max: 90 },
  { label: '£9.1–11.0m', min: 91, max: 110 },
  { label: '> £11.0m', min: 111, max: Infinity },
];

export function byPriceBand(
  rows: Observation[],
): { label: string; stats: ErrorStats }[] {
  return PRICE_BANDS.map((b) => ({
    label: b.label,
    stats: errorStats(rows.filter((r) => r.value >= b.min && r.value <= b.max)),
  }));
}

export function byPosition(
  rows: Observation[],
): { label: string; stats: ErrorStats }[] {
  const positions = [...new Set(rows.map((r) => r.position))].sort();
  return positions.map((p) => ({
    label: p,
    stats: errorStats(rows.filter((r) => r.position === p)),
  }));
}
