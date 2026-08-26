import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from '../projections/scoring';
import { DEFCON_THRESHOLD } from '../projections/points';
import { thresholdProbability } from '../projections/distributions';
import { FittedParams, UNFITTED_PARAMS } from '../projections/fitted';
import { HistoryRow, walkRounds } from '../projections/features';
import { observationsFor, runBacktest } from './harness';
import { errorStats } from './metrics';

/**
 * Fits the model's constants to history (B-007 Phase 4c).
 *
 * Two kinds of parameter, fitted two ways:
 *
 *   - **Directly measurable** — P(60+ | started), goals per unit of xG, home advantage. These are
 *     counts and ratios over the training rows. No search, no objective, no way to overfit them.
 *   - **Shape parameters** — the shrinkage window, the fixture elasticities, the defensive-contribution
 *     overdispersion. These change how the model behaves rather than describing an observed frequency,
 *     so they are chosen by a small grid search against held-out error.
 *
 * Everything here reads TRAINING rows only. The caller decides which those are, and the split is the
 * point: fitting and evaluating on the same rows produces a model that grades its own homework.
 */

export interface FitInput {
  /**
   * Rows the fit may learn from — training seasons ONLY.
   *
   * Kept separate from `defconTrain` because they are contaminated differently. Everything measured
   * here (frequencies, the start curve, the shrinkage targets) must never see the test season, or the
   * holdout claim is false for every parameter rather than for the one documented exception.
   */
  train: HistoryRow[];
  /**
   * The defensive-contribution exception, and nothing else reads it.
   *
   * That category exists only in the test season, so its parameters cannot be fitted anywhere else.
   * Isolating those rows here is what keeps "2025-26 is held out" true of every OTHER parameter — an
   * earlier version folded them into `train`, where the frequency measurements iterated them too, so
   * a quarter of the test season silently informed the whole fit while the provenance claimed
   * otherwise.
   */
  defconTrain: HistoryRow[];
  /** rows used only to choose shape parameters — never scored in the final report */
  validate: HistoryRow[];
  /**
   * A SECOND validation set, for the defensive-contribution shape only.
   *
   * The main validation set is 2024-25, where the category does not exist — so every candidate value
   * scored identically there, to four decimal places, and the search was measuring nothing while
   * looking like it had converged. The category lives in one season, so its parameter is fitted on the
   * early rounds of that season and validated on the rounds just after, and both facts are reported.
   */
  defconValidate: HistoryRow[];
  scoringFor: (season: string) => Scoring;
}

export interface FitReport {
  params: FittedParams;
  measured: Record<string, number>;
  searched: {
    name: string;
    chosen: number;
    candidates: { value: number; rmse: number; mae: number }[];
    /** true when the winner is the first or last candidate — the optimum is outside the grid */
    atGridBoundary: boolean;
  }[];
  leagueRates: Record<PositionCode, Record<string, number>>;
}

export function fitParams(input: FitInput): FitReport {
  const { train, defconTrain, validate, defconValidate, scoringFor } = input;

  const measured = measureDirect(train);
  const leagueRates = measureLeagueRates(train);

  let params: FittedParams = {
    ...UNFITTED_PARAMS,
    strength: {
      ...UNFITTED_PARAMS.strength,
      homeAdvantage: measured.homeAdvantage,
      leagueGoalsPerTeamMatch: measured.leagueGoalsPerTeamMatch,
    },
    minutes: {
      startIntercept: measured.startIntercept,
      startSlope: measured.startSlope,
      subAppearanceRate: measured.subAppearanceRate,
      sixtyGivenStart: measured.sixtyGivenStart,
      sixtyGivenSub: measured.sixtyGivenSub,
      minutesGivenStart: measured.minutesGivenStart,
      minutesGivenSub: measured.minutesGivenSub,
    },
    attack: {
      ...UNFITTED_PARAMS.attack,
      goalsPerXg: measured.goalsPerXg,
      assistsPerXa: measured.assistsPerXa,
    },
    bonus: {
      bonusPerBps: measured.bonusPerBps,
      bpsIntercept: measured.bpsIntercept,
      maxBonus: 3,
    },
    defcon: {
      ...UNFITTED_PARAMS.defcon,
      dispersion: fitDispersion(defconTrain),
    },
  };

  // Shape parameters, each chosen against held-out error with the others held at their current value.
  // A joint search over four axes would fit the validation set itself; one pass each is the honest
  // amount of searching for the amount of data behind it.
  //
  // **The objective is RMSE, not MAE, and that is not a detail.** The first run searched on MAE and
  // every one of the four parameters ran to the edge of its grid, each in the direction that made
  // predictions smaller. MAE is minimised by the conditional MEDIAN, and on this corpus the median
  // outcome is close to zero — most rows are players who did not feature — so the cheapest way to cut
  // MAE is to predict everyone low. That is the opposite of what a squad optimiser needs: it compares
  // players against each other, so a uniformly shrunken model is worse than a noisy honest one.
  // RMSE is minimised by the conditional MEAN, which is the quantity the model claims to estimate.
  // MAE is still reported, as a description rather than a target.
  const searched: FitReport['searched'] = [];
  // Identity set, not `validate.includes` — that is O(n) per row inside a per-row loop, which over
  // 87,000 rows is an hour of nothing.
  const validateSet = new Set(validate);
  const combined = [...train, ...validate];

  const defconSet = new Set(defconValidate);
  const combinedDefcon = [...train, ...defconTrain, ...defconValidate];

  const search = (
    name: string,
    candidates: number[],
    apply: (p: FittedParams, v: number) => FittedParams,
    which: 'main' | 'defcon' = 'main',
  ) => {
    const rows = which === 'defcon' ? combinedDefcon : combined;
    const set = which === 'defcon' ? defconSet : validateSet;
    const scored = candidates.map((value) => {
      const trial = apply(params, value);
      const run = runBacktest(rows, trial, scoringFor, {
        evaluate: (row) => set.has(row),
      });
      // The MODEL's own rows, deliberately NOT restricted to the rows every baseline could also
      // score. B-012 restricts *comparisons* to a common population, because comparing two
      // predictors over different rows is not a comparison. A grid search compares a parameter
      // against itself on one predictor, so the restriction would do nothing but throw away the
      // hardest rows — debuts and returns, exactly where a minutes parameter earns its keep — and
      // move every fitted constant for a reason no report would explain.
      const stats = errorStats(observationsFor(run.rows, 'model'));
      return { value, rmse: stats.rmse, mae: stats.mae };
    });
    const best = scored.reduce((a, b) => (b.rmse < a.rmse ? b : a));
    params = apply(params, best.value);

    // A winner sitting at either end of the grid is not an optimum, it is the edge of where we
    // looked — the real minimum is outside. Reported rather than quietly accepted, because a
    // boundary hit reads exactly like a converged search in a table of numbers.
    // The lower end of an elasticity grid is 0, which means "this input has no effect" — a real
    // answer, not the edge of where we looked. Only the upper end is treated as a boundary there.
    const floorIsMeaningful = name.endsWith('Elasticity');
    const atBoundary =
      (!floorIsMeaningful && best.value === scored[0].value) ||
      best.value === scored[scored.length - 1].value;

    searched.push({
      name,
      chosen: best.value,
      candidates: scored,
      atGridBoundary: atBoundary,
    });
  };

  // Grids widened after the first run put three of four winners on an edge.
  search(
    'strength.confidenceMatches',
    [2, 4, 8, 12, 16, 24, 32, 48, 64, 96],
    (p, v) => ({ ...p, strength: { ...p.strength, confidenceMatches: v } }),
  );
  search(
    'attack.xgFixtureElasticity',
    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
    (p, v) => ({ ...p, attack: { ...p.attack, xgFixtureElasticity: v } }),
  );
  search(
    'attack.xaFixtureElasticity',
    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
    (p, v) => ({ ...p, attack: { ...p.attack, xaFixtureElasticity: v } }),
  );
  search(
    'defcon.ratePer90ToMatch',
    [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2],
    (p, v) => ({ ...p, defcon: { ...p.defcon, ratePer90ToMatch: v } }),
    'defcon',
  );

  return { params, measured, searched, leagueRates };
}

/**
 * The parameters that are frequencies, not choices. Each is a count over training rows.
 */
function measureDirect(rows: HistoryRow[]): Record<string, number> {
  let started = 0;
  let startedSixty = 0;
  let startedMinutes = 0;
  let notStarted = 0;
  let subAppeared = 0;
  let subSixty = 0;
  let subMinutes = 0;

  let xg = 0;
  let goals = 0;
  let xa = 0;
  let assists = 0;

  let bpsSum = 0;
  let bonusSum = 0;
  let bpsSq = 0;
  let bpsBonus = 0;
  let scoredRows = 0;

  const homeXg = { total: 0, fixtures: new Set<string>() };
  const awayXg = { total: 0, fixtures: new Set<string>() };

  for (const r of rows) {
    if (r.starts > 0) {
      started++;
      startedMinutes += r.minutes;
      if (r.minutes >= 60) startedSixty++;
    } else {
      notStarted++;
      if (r.minutes > 0) {
        subAppeared++;
        subMinutes += r.minutes;
        if (r.minutes >= 60) subSixty++;
      }
    }

    xg += r.expectedGoals;
    goals += r.goalsScored;
    xa += r.expectedAssists;
    assists += r.assists;

    // Bonus is only meaningful for players who were on the pitch; including 0-minute rows would drag
    // the fitted line to zero and make every projection's bonus term vanish.
    if (r.minutes > 0) {
      scoredRows++;
      bpsSum += r.bps;
      bonusSum += r.bonus;
      bpsSq += r.bps * r.bps;
      bpsBonus += r.bps * r.bonus;
    }

    const key = `${r.season}|${r.round}|${r.fixture}`;
    if (r.wasHome) {
      homeXg.total += r.expectedGoals;
      homeXg.fixtures.add(key);
    } else {
      awayXg.total += r.expectedGoals;
      awayXg.fixtures.add(key);
    }
  }

  const homePerMatch =
    homeXg.fixtures.size > 0 ? homeXg.total / homeXg.fixtures.size : 1.4;
  const awayPerMatch =
    awayXg.fixtures.size > 0 ? awayXg.total / awayXg.fixtures.size : 1.4;

  // Least squares of bonus on BPS over rows where the player featured.
  const n = Math.max(1, scoredRows);
  const meanBps = bpsSum / n;
  const meanBonus = bonusSum / n;
  const varBps = bpsSq / n - meanBps * meanBps;
  const covar = bpsBonus / n - meanBps * meanBonus;
  const bonusPerBps = varBps > 0 ? covar / varBps : 0;

  return {
    sixtyGivenStart: started > 0 ? startedSixty / started : 0.85,
    sixtyGivenSub: subAppeared > 0 ? subSixty / subAppeared : 0.05,
    subAppearanceRate: notStarted > 0 ? subAppeared / notStarted : 0.35,
    minutesGivenStart: started > 0 ? startedMinutes / started : 85,
    minutesGivenSub: subAppeared > 0 ? subMinutes / subAppeared : 25,
    goalsPerXg: xg > 0 ? goals / xg : 1,
    assistsPerXa: xa > 0 ? assists / xa : 1,
    bonusPerBps,
    bpsIntercept: meanBonus - bonusPerBps * meanBps,
    homeAdvantage:
      awayPerMatch > 0 ? Math.sqrt(homePerMatch / awayPerMatch) : 1.15,
    leagueGoalsPerTeamMatch: (homePerMatch + awayPerMatch) / 2,
    // The start model is fitted as a calibration of the lagged rate onto the realised one; see
    // fitStartCurve for why it is a two-parameter logistic rather than the identity v1 assumed.
    ...fitStartCurve(rows),
  };
}

/**
 * P(start) is NOT the lagged start rate.
 *
 * v1 used the lagged rate directly, which assumes a player who started 8 of their last 10 starts the
 * next one with probability 0.8. Realised behaviour is more extreme at both ends — nailed starters
 * regress toward 1, fringe players toward 0 — so a two-parameter logistic on the logit of the lagged
 * rate is fitted instead, by Newton steps on the log-likelihood.
 */
function fitStartCurve(rows: HistoryRow[]): {
  startIntercept: number;
  startSlope: number;
} {
  // Build (laggedRate, started) pairs with a strict cut, using the same walk the harness uses.
  const points: { x: number; y: number }[] = [];
  for (const context of walkRounds(rows, UNFITTED_PARAMS)) {
    for (const { row, features } of context.items) {
      if (features.matchesSample === 0) continue;
      points.push({
        x: logit(features.laggedStartRate),
        y: row.starts > 0 ? 1 : 0,
      });
    }
  }
  if (points.length === 0) return { startIntercept: 0, startSlope: 1 };

  // Ridge penalty and damped steps, both required rather than tidy.
  //
  // The first run of this fit returned a slope of 7.3e8 — complete separation. A lagged start rate is
  // very nearly a perfect predictor of the next start, so the unpenalised likelihood keeps improving
  // as the coefficients run to infinity, and Newton obliges. The resulting "model" is a step function:
  // P(start) is exactly 0 or 1, every rotation risk becomes a certainty in one direction or the other,
  // and the MAE barely moves — which is precisely how a broken fit survives an error metric.
  const RIDGE = 1e-3;
  let a = 0;
  let b = 1;

  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const p of points) {
      const z = a + b * p.x;
      const mu = 1 / (1 + Math.exp(-z));
      const w = mu * (1 - mu);
      const r = p.y - mu;
      g0 += r;
      g1 += r * p.x;
      h00 += w;
      h01 += w * p.x;
      h11 += w * p.x * p.x;
    }
    g0 -= RIDGE * a * points.length;
    g1 -= RIDGE * b * points.length;
    h00 += RIDGE * points.length;
    h11 += RIDGE * points.length;

    const det = h00 * h11 - h01 * h01;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-12) break;
    let da = (h11 * g0 - h01 * g1) / det;
    let db = (h00 * g1 - h01 * g0) / det;

    // Cap the step so a near-singular Hessian cannot throw the parameters into the millions.
    const step = Math.max(Math.abs(da), Math.abs(db));
    if (step > 1) {
      da /= step;
      db /= step;
    }
    a += da;
    b += db;
    if (Math.abs(da) < 1e-8 && Math.abs(db) < 1e-8) break;
  }

  // A slope beyond this is not a fit, it is separation that survived the penalty. Fall back to the
  // identity — v1's assumption — rather than shipping a step function that no metric would flag.
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 20) {
    return { startIntercept: 0, startSlope: 1 };
  }
  return { startIntercept: a, startSlope: b };
}

/**
 * Overdispersion of the defensive-action count.
 *
 * Chosen to match the OBSERVED frequency of clearing the threshold, per position, rather than by
 * minimising points error — the threshold rate is a probability the model claims, and a probability
 * should be judged against how often the thing happens. Poisson (dispersion 1) understates the spread
 * because defensive actions cluster.
 *
 * Only 2025-26 carries the category, so this is fitted on the rows that have it and nothing else.
 */
function fitDispersion(rows: HistoryRow[]): number {
  // Lagged rate in, realised outcome out — the same pairing the model faces at prediction time.
  //
  // The first version of this used each row's OWN realised count as its lambda, which is circular:
  // a distribution centred on the outcome it is predicting looks perfectly calibrated at any spread,
  // and the fit duly returned "Poisson, no overdispersion" for every candidate.
  const samples: { lambda: number; hit: number; threshold: number }[] = [];
  for (const context of walkRounds(rows, UNFITTED_PARAMS)) {
    for (const { row: r, features } of context.items) {
      if (r.defensiveContribution === null || r.minutes < 60) continue;
      const threshold = DEFCON_THRESHOLD[r.position];
      if (threshold <= 0) continue;
      if (features.matchesSample === 0) continue;
      samples.push({
        lambda: features.rates.defcon90 * (r.minutes / 90),
        hit: r.defensiveContribution >= threshold ? 1 : 0,
        threshold,
      });
    }
  }
  if (samples.length < 500) return 1;

  const candidates = [1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4];
  let best = { value: 1, loss: Infinity };

  for (const dispersion of candidates) {
    let loss = 0;
    for (const s of samples) {
      const p = thresholdProbability(s.lambda, s.threshold, dispersion);
      loss -= s.hit * Math.log(clampP(p)) + (1 - s.hit) * Math.log(clampP(1 - p));
    }
    if (loss < best.loss) best = { value: dispersion, loss };
  }
  return best.value;
}

/** The shrinkage targets for a player with no history — measured rather than guessed. */
function measureLeagueRates(
  rows: HistoryRow[],
): Record<PositionCode, Record<string, number>> {
  const positions: PositionCode[] = ['GKP', 'DEF', 'MID', 'FWD'];
  const out = {} as Record<PositionCode, Record<string, number>>;

  for (const position of positions) {
    const played = rows.filter((r) => r.position === position && r.minutes > 0);
    const minutes = played.reduce((s, r) => s + r.minutes, 0);
    const defconRows = played.filter((r) => r.defensiveContribution !== null);
    const defconMinutes = defconRows.reduce((s, r) => s + r.minutes, 0);
    const per90 = (total: number, mins: number) =>
      mins > 0 ? (total / mins) * 90 : 0;

    out[position] = {
      xg90: per90(played.reduce((s, r) => s + r.expectedGoals, 0), minutes),
      xa90: per90(played.reduce((s, r) => s + r.expectedAssists, 0), minutes),
      defcon90: per90(
        defconRows.reduce((s, r) => s + (r.defensiveContribution ?? 0), 0),
        defconMinutes,
      ),
      saves90: per90(played.reduce((s, r) => s + r.saves, 0), minutes),
      bps90: per90(played.reduce((s, r) => s + r.bps, 0), minutes),
    };
  }
  return out;
}

function logit(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
}

function clampP(p: number): number {
  return Math.min(1 - 1e-9, Math.max(1e-9, p));
}
