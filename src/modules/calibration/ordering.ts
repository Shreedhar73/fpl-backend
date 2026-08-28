import { PredictionRow, Predictor } from './harness';

/**
 * Does the model put the right players at the top? (B-012 Phase 1.)
 *
 * The optimiser never asks what a player will score. It asks which fifteen, which eleven of those,
 * and who takes the armband — every one an ordering question over a few hundred candidates. Nothing
 * in this project measured ordering until now, which is how a model could lose on MAE, win on RMSE,
 * and leave everyone unable to say whether it was better.
 *
 * **Two things drive every design choice in this file.**
 *
 * 1. **Ties are the norm, not an edge case.** Realised FPL points are massively tied — hundreds of
 *    players on 0, 1 or 2 in any round. A rank correlation that does not average ranks within ties is
 *    simply the wrong number here, and a precision@k whose boundary falls inside a tie depends on
 *    sort order rather than on the model.
 * 2. **Rounds are scored separately and then aggregated, never pooled.** Pooling conflates "ranked
 *    this round's players well" with "knew which rounds were high-scoring", which is a different and
 *    much easier question. A model that predicted every player's season average would look good
 *    pooled and be worthless in the only ranking that matters — the one inside a single deadline.
 */

/** Ranks, averaged within ties. Rank 1 is the largest value. */
export function rankDescending(values: number[]): number[] {
  const order = values
    .map((v, i) => ({ v, i }))
    .sort((a, b) => b.v - a.v);
  const ranks = new Array<number>(values.length);
  let i = 0;
  while (i < order.length) {
    let j = i;
    while (j + 1 < order.length && order[j + 1].v === order[i].v) j++;
    // Every member of a tie takes the average of the ranks the group spans. Without this, two
    // players on 0 points get ranks 400 and 401 for no reason, and the coefficient reports a
    // precision the data does not contain.
    const shared = (i + j + 2) / 2;
    for (let k = i; k <= j; k++) ranks[order[k].i] = shared;
    i = j + 1;
  }
  return ranks;
}

/**
 * Spearman's rho with tie correction — Pearson's correlation over averaged ranks.
 *
 * Returns `null` when either side has no variation at all (every value identical), which happens in
 * a round where nobody scored. That is an undefined correlation, not a zero one, and averaging a
 * fabricated zero into the season would drag the aggregate down for rounds that said nothing.
 */
export function spearman(a: number[], b: number[]): number | null {
  if (a.length !== b.length) throw new Error('spearman: length mismatch');
  if (a.length < 2) return null;
  const ra = rankDescending(a);
  const rb = rankDescending(b);
  const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;
  const ma = mean(ra);
  const mb = mean(rb);
  let num = 0;
  let da = 0;
  let db = 0;
  for (let i = 0; i < ra.length; i++) {
    const x = ra[i] - ma;
    const y = rb[i] - mb;
    num += x * y;
    da += x * x;
    db += y * y;
  }
  if (da === 0 || db === 0) return null;
  return num / Math.sqrt(da * db);
}

/**
 * The share of the achievable points the predictor's top *k* actually captured.
 *
 * **The primary top-k metric, and it is chosen over precision@k because it is tie-robust.** Taking
 * the model's best *k* and the true best *k* and dividing one realised total by the other asks the
 * question in the units the game is played in: how much of what was there did this ranking get?
 * A tie at the boundary changes which player is taken and not how many points come with them.
 *
 * Returns `null` when the true top *k* scored nothing — the ratio is 0/0, not 0.
 */
export function pointsCaptured(
  predicted: number[],
  actual: number[],
  k: number,
): number | null {
  if (predicted.length !== actual.length) {
    throw new Error('pointsCaptured: length mismatch');
  }
  if (predicted.length < k) return null;
  // Ties here resolve to array index, and the array is a round's rows. That is deterministic ONLY
  // because the rows arrive in one canonical order (`sortRows`, B-039) — this function is handed
  // bare numbers and has no player identity to break a tie with. If the row order ever floats
  // again, the top-k cut floats with it.
  const byPredicted = predicted
    .map((p, i) => ({ p, i }))
    .sort((a, b) => b.p - a.p || a.i - b.i)
    .slice(0, k);
  const best = [...actual].sort((a, b) => b - a).slice(0, k);
  const ceiling = best.reduce((s, x) => s + x, 0);
  if (ceiling <= 0) return null;
  const got = byPredicted.reduce((s, x) => s + actual[x.i], 0);
  return got / ceiling;
}

/**
 * Overlap between the predictor's top *k* and the true top *k*.
 *
 * **Secondary, and fragile — read `pointsCaptured` first.** When the true top *k* has a tie at its
 * boundary, "the true top k" is not a well-defined set: which of the tied players is counted depends
 * on sort order, so this metric moves for reasons that have nothing to do with the model.
 */
export function precisionAtK(
  predicted: number[],
  actual: number[],
  k: number,
): number | null {
  if (predicted.length < k) return null;
  const top = (xs: number[]) =>
    new Set(
      xs
        .map((v, i) => ({ v, i }))
        .sort((a, b) => b.v - a.v || a.i - b.i)
        .slice(0, k)
        .map((x) => x.i),
    );
  const mine = top(predicted);
  const theirs = top(actual);
  let hit = 0;
  for (const i of mine) if (theirs.has(i)) hit++;
  return hit / k;
}

export const DEFAULT_KS = [11, 15, 30];

export interface RoundOrdering {
  season: string;
  round: number;
  n: number;
  spearman: number | null;
  pointsCaptured: Map<number, number | null>;
  precision: Map<number, number | null>;
}

export interface OrderingSummary {
  /** rounds that produced a number — a round where nobody scored produces none */
  rounds: number;
  meanSpearman: number | null;
  meanPointsCaptured: Map<number, number | null>;
  meanPrecision: Map<number, number | null>;
}

/** How the candidate field is narrowed before ranking. The optimiser never ranks all 600 at once. */
export interface OrderingView {
  label: string;
  /** rows of one round, already restricted to the comparison population */
  restrict: (rows: PredictionRow[], predictor: Predictor) => PredictionRow[];
}

export const ORDERING_VIEWS: OrderingView[] = [
  { label: 'whole field', restrict: (rows) => rows },
  {
    label: 'top 100 by price',
    // Price is the field the optimiser is actually constrained by, and it is knowable before the
    // round. Ranking the whole 600 measures a job nobody does.
    // Tie-broken on `playerCode` (B-039): at 100 of ~550 the cut lands in a crowd of equal prices,
    // and which side of it a player falls on decides whether the round scores them at all.
    restrict: (rows) =>
      [...rows]
        .sort((a, b) => b.value - a.value || a.playerCode - b.playerCode)
        .slice(0, 100),
  },
  {
    label: 'top 100 by predicted',
    // The predictor's own shortlist — the players it would put in front of the solver. A model can
    // rank the field well and still be wrong about exactly the players it likes, which is the error
    // that reaches a recommendation.
    restrict: (rows, predictor) =>
      [...rows]
        .sort(
          (a, b) =>
            (b.predicted[predictor] ?? 0) - (a.predicted[predictor] ?? 0) ||
            a.playerCode - b.playerCode,
        )
        .slice(0, 100),
  },
];

export function orderingByRound(
  rows: PredictionRow[],
  predictor: Predictor,
  view: OrderingView = ORDERING_VIEWS[0],
  ks: number[] = DEFAULT_KS,
): RoundOrdering[] {
  const byRound = new Map<string, PredictionRow[]>();
  for (const r of rows) {
    const key = `${r.season}|${r.round}`;
    const list = byRound.get(key);
    if (list) list.push(r);
    else byRound.set(key, [r]);
  }

  const out: RoundOrdering[] = [];
  for (const [key, all] of byRound) {
    const [season, round] = key.split('|');
    const scoped = view.restrict(all, predictor);
    const predicted = scoped.map((r) => r.predicted[predictor] ?? 0);
    const actual = scoped.map((r) => r.actual);
    out.push({
      season,
      round: Number(round),
      n: scoped.length,
      spearman: spearman(predicted, actual),
      pointsCaptured: new Map(
        ks.map((k) => [k, pointsCaptured(predicted, actual, k)]),
      ),
      precision: new Map(ks.map((k) => [k, precisionAtK(predicted, actual, k)])),
    });
  }
  return out.sort((a, b) => a.season.localeCompare(b.season) || a.round - b.round);
}

export function summariseOrdering(
  rounds: RoundOrdering[],
  ks: number[] = DEFAULT_KS,
): OrderingSummary {
  const meanOf = (values: (number | null)[]): number | null => {
    const real = values.filter((v): v is number => v !== null);
    return real.length === 0
      ? null
      : real.reduce((s, x) => s + x, 0) / real.length;
  };
  return {
    rounds: rounds.filter((r) => r.spearman !== null).length,
    meanSpearman: meanOf(rounds.map((r) => r.spearman)),
    meanPointsCaptured: new Map(
      ks.map((k) => [k, meanOf(rounds.map((r) => r.pointsCaptured.get(k) ?? null))]),
    ),
    meanPrecision: new Map(
      ks.map((k) => [k, meanOf(rounds.map((r) => r.precision.get(k) ?? null))]),
    ),
  };
}
