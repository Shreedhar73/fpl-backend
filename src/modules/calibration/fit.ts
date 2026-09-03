import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from '../projections/scoring';
import { DEFCON_THRESHOLD } from '../projections/points';
import { thresholdProbability } from '../projections/distributions';
import { FittedParams, UNFITTED_PARAMS } from '../projections/fitted';
import { HistoryRow, walkRounds } from '../projections/features';
import { availabilitySignal } from '../projections/model-v2';
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
  /**
   * Use the imputed start probabilities on rows the archive never labelled (plan 027 task 6).
   *
   * Default OFF. On, the seven seasons before 2023-24 contribute to the minutes curves for the first
   * time, weighted by how sure the imputation is; off, `fitParams` behaves exactly as it did, which
   * is what makes the comparison between the two a measurement rather than a change.
   */
  imputedStarts?: boolean;
  /**
   * Seasons of half-life for the recency weighting; `Infinity` weights every season equally.
   *
   * Defaults to `SEASON_HALF_LIFE`, which is the environment variable, so an unset caller behaves
   * exactly as before. Passed explicitly by the per-fold selection (plan 027 task 4), which is the
   * only way several candidate decays can be fitted inside one process.
   */
  seasonHalfLife?: number;
  /**
   * How the deadline-time availability flags enter the fit (B-040, plan 027 task 8).
   *
   * - `joint` — plan 024's regime: the flags are features of the two logistics, with an interaction
   *   against the lagged start rate. Fitted params carry `minutes.availability`, and the model reads
   *   the flags directly.
   * - `unflagged-base` — the hybrid D-032's reading argued for. Rows carrying ANY doubt are excluded
   *   from the base curves entirely, so the curves describe the players nobody had a question about;
   *   the params carry no `availability` block, so the model falls back to applying FPL's own chance
   *   percentage MULTIPLICATIVELY. That is the shape D-032 found the joint fit could not express: a
   *   near-calibrated percentage applied as a rescale is not a linear term in a logit.
   * - `none` — flags are ignored entirely, which is where v3 was before plan 024.
   *
   * Defaults to `joint`, which is what `fitParams` did before this option existed.
   */
  availabilityMode?: 'joint' | 'unflagged-base' | 'none';
  /**
   * Career pseudo-matches blended into the season start rate (B-042, plan 029 task 5).
   *
   * The start and sub curves are regressions ON the lagged start rate, so a candidate value here
   * changes the feature the curves are fitted to and is a refit, not a rescore. Passed through to
   * the walk the fit reads and written into the fitted params, so the model is scored under the
   * same feature it was fitted on. Absent or 0 is the incumbent.
   */
  startRateShrink?: number;
}

export interface FitReport {
  params: FittedParams;
  measured: ReturnType<typeof measureDirect>;
  searched: {
    name: string;
    chosen: number;
    candidates: { value: number; rmse: number; mae: number }[];
    /** true when the winner is the first or last candidate — the optimum is outside the grid */
    atGridBoundary: boolean;
    /** worst minus best RMSE across the grid — how much the parameter is worth at all */
    spread: number;
    /**
     * true when that spread is below `FLAT_EPSILON`, i.e. the objective cannot tell the candidates
     * apart and the "winner" is noise.
     */
    flat: boolean;
  }[];
  leagueRates: Record<PositionCode, Record<string, number>>;
}

/**
 * How much held-out RMSE a grid has to move before its winner means anything.
 *
 * In points, against a corpus RMSE of about 1.95 — so this is roughly 0.05% of the objective. Below
 * it, the candidates are indistinguishable and the ordering is noise.
 */
const FLAT_EPSILON = 0.001;

/**
 * How fast a season's evidence decays, in seasons, or Infinity for "every season counts equally".
 *
 * Extending the archive from two seasons to nine made the model WORSE — 1945 against 1982 in a
 * simulated 2025-26 under `greedy-1ft`. The corpus is not the problem; treating 2016-17 as evidence
 * about 2025-26 on equal terms is. Football moves, and nothing in the fit knew that a row had an age.
 *
 * A row from `d` seasons before the most recent training season is weighted `0.5 ** (d / halfLife)`.
 *
 * **The reason is mechanical, not statistical: the league changed, and two of the changes are
 * visible in these very rows.**
 *
 * Substitutions went from three to five in 2022-23, and the archive shows the break rather than a
 * drift — short appearances (0 < minutes < 60) per fixture, and appearances per fixture:
 *
 *     2016-17 .. 2021-22   6.3 – 7.0 short,  27.4 – 27.9 total
 *     2022-23 .. 2025-26   9.2 – 9.9 short,  29.9 – 30.4 total
 *
 * Forty-two per cent more substitute appearances, from one season to the next, held ever since. For
 * anything about minutes, a pre-2022-23 row is evidence about a different sport.
 *
 * Home advantage has its own discontinuity. Home goals divided by away goals per fixture:
 *
 *     2016-17 1.318   2017-18 1.347   2018-19 1.232   2019-20 1.239
 *     2020-21 1.012   <- played behind closed doors; the edge disappears
 *     2021-22 1.138   <- partial crowds
 *     2022-23 1.338   2023-24 1.219   2024-25 1.040   2025-26 1.214
 *
 * `homeAdvantage` is a single fitted constant. Pooling ten seasons equally hands it a season in
 * which home advantage did not exist.
 *
 * ONE season, and the season simulation agrees with the mechanism — 2025-26 under `greedy-1ft`,
 * nine training seasons throughout:
 *
 *     half-life   0.5    0.75    1      2      4      none
 *     season     1847    1919   1999   1996   1961    1945
 *
 * An interior optimum, falling away on both sides. The two seasons the model used to train on
 * scored 1982, so the older seasons ARE worth having — but only once they stop counting as equal
 * evidence, which is exactly what the substitution and crowd breaks predict.
 *
 * That the mechanism and the curve agree matters, because the curve alone would be selection on the
 * test season: this parameter moves the season simulation, and that runs on 2025-26 only. The
 * direction was predicted from the rule changes before the sweep ran, which is the part that is not
 * fitted to 2025-26. Confirmation is 2026-27 as it plays.
 *
 * **Default OFF, and not adopted.** The evidence above is real but two things are unfinished: the
 * half-life was picked on runs that also carried the fitted-availability block (which the served
 * model rejects, so those numbers measured two changes at once), and the parameters it produces
 * fail a behavioural test — a substitute-only defender comes out at P(60+) = 0.175 against a bound
 * of 0.15, because the start intercept rises. Set `SEASON_HALF_LIFE=1` to reproduce the candidate.
 *
 * With the decay off this file reproduces the unweighted fit exactly, which the tests assert.
 */
export const SEASON_HALF_LIFE =
  Number(process.env.SEASON_HALF_LIFE) || Infinity;

/**
 * season label → its weight, newest season in the corpus being 1.0
 *
 * The half-life is a PARAMETER, defaulting to the environment variable that used to be the only way
 * to set it (B-040, plan 027 task 4). It has to be one: selecting a window and a decay per fold
 * means fitting the same rows several ways inside one process, and a module-level constant read from
 * `process.env` cannot vary between two fits in the same run — a sweep built on it would report
 * several candidates that were all secretly the same fit.
 */
function seasonWeights(
  rows: HistoryRow[],
  halfLife: number = SEASON_HALF_LIFE,
): Map<string, number> {
  const seasons = [...new Set(rows.map((r) => r.season))].sort();
  const newest = seasons.length - 1;
  const out = new Map<string, number>();
  seasons.forEach((season, i) => {
    const age = newest - i;
    out.set(
      season,
      Number.isFinite(halfLife) ? Math.pow(0.5, age / halfLife) : 1,
    );
  });
  return out;
}

/**
 * What a row says about whether it was a start, and how sure that is (B-040, plan 027 task 6).
 *
 * Three states, and collapsing any two of them is a measured bug this project has already paid for:
 *
 *  - a RECORDED label — weight 1 on the value the archive holds;
 *  - an IMPUTED probability — `startProb`, present only where `starts` is null, and only when the
 *    caller asked for it. The row enters both classes, weighted p and 1−p, so a 45-minute
 *    appearance contributes half a start and half a substitute rather than a coin flip that the fit
 *    then treats as fact;
 *  - NOTHING — the row cannot speak to the question and is skipped, which is what every season
 *    before 2023-24 does when imputation is off.
 *
 * `imputed` is opt-in and defaults OFF. Turning it on changes every minutes parameter, so it is an
 * arm of a measured comparison (the rolling-origin referee, D-034) and never a quiet default.
 */
function startEvidence(
  row: HistoryRow,
  imputed: boolean,
): { p: number; recorded: boolean } | null {
  if (row.starts !== null) return { p: row.starts > 0 ? 1 : 0, recorded: true };
  if (!imputed) return null;
  const p = row.startProb;
  if (p === null || p === undefined) return null;
  return { p, recorded: false };
}

export function fitParams(input: FitInput): FitReport {
  const { train, defconTrain, validate, defconValidate, scoringFor } = input;
  const imputedStarts = input.imputedStarts ?? false;
  const halfLife = input.seasonHalfLife ?? SEASON_HALF_LIFE;
  const availabilityMode = input.availabilityMode ?? 'joint';

  const startRateShrink = input.startRateShrink ?? 0;
  const measured = measureDirect(
    train,
    imputedStarts,
    halfLife,
    availabilityMode,
    startRateShrink,
  );
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
      subIntercept: measured.subIntercept,
      subSlope: measured.subSlope,
      sixtyGivenStart: measured.sixtyGivenStart,
      sixtyGivenSub: measured.sixtyGivenSub,
      minutesGivenStart: measured.minutesGivenStart,
      minutesGivenSub: measured.minutesGivenSub,
      // Written into the params so `walkRounds` builds the SAME feature at scoring time that the
      // curves were regressed on. Left off entirely at 0, so the incumbent's params shape is
      // byte-identical to what it was.
      ...(startRateShrink > 0 ? { startRateShrink } : {}),
      gkp: measured.gkp,
      // Only the joint regime emits the availability block, and emitting it is what SWITCHES the
      // model's regime — `minutesDistribution` reads the flags directly when it is present and
      // applies FPL's chance percentage multiplicatively when it is not. So the hybrid is expressed
      // by leaving it off, not by a second code path in the model.
      availability:
        availabilityMode === 'joint' ? measured.availability : undefined,
    },
    saves: { elasticity: 1 },
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
    /**
     * The candidate that means "this input has no effect". When the objective cannot tell the grid
     * apart, this one is taken instead of the nominal winner.
     */
    nullValue?: number,
    /**
     * Score the objective over ONE position's rows (B-021). A keeper-only parameter judged on the
     * whole field is judged on 89% rows it cannot touch — the grid reads flat and the null wins
     * whatever the keeper rows say. B-021's own trap runs the other way too, so the per-position n
     * lands in the report beside the choice.
     */
    filterPosition?: string,
  ) => {
    const rows = which === 'defcon' ? combinedDefcon : combined;
    const set = which === 'defcon' ? defconSet : validateSet;
    const scored = candidates.map((value) => {
      const trial = apply(params, value);
      const run = runBacktest(rows, trial, scoringFor, {
        evaluate: (row) =>
          set.has(row) &&
          (filterPosition === undefined || row.position === filterPosition),
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
    let best = scored.reduce((a, b) => (b.rmse < a.rmse ? b : a));

    // **A grid search always returns a winner, including when the objective is flat.** That is the
    // shape of check that cannot fail: the table looks like a converged search either way, and the
    // model then carries a parameter chosen by the fourth decimal of a noisy RMSE. Measured here:
    // the assist elasticity scored 1.9497 at every value from 1.0 to 2.0, and the search duly
    // "chose" 1.5 — which would have shipped as a claim that the fixture moves assists by half
    // again, on evidence of 0.0007 points of RMSE.
    //
    // So when the whole grid lands inside FLAT_EPSILON, the null candidate wins instead: adopting a
    // non-zero effect the data cannot distinguish from zero is a claim, and declining to make it is
    // the smaller error. The report says `flat` either way, so the choice is visible rather than
    // silent.
    const spread =
      Math.max(...scored.map((c) => c.rmse)) -
      Math.min(...scored.map((c) => c.rmse));
    const flat = spread < FLAT_EPSILON;
    if (flat && nullValue !== undefined) {
      best = scored.find((c) => c.value === nullValue) ?? best;
    }
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
      spread,
      flat,
    });
  };

  // **Strength first, elasticities second, and the order is the whole experiment.** An elasticity
  // fitted on top of a strength estimate that carries no information will fit to zero whatever the
  // true fixture effect is — which is exactly what happened in B-007 and is what B-014 exists to
  // test. So the definition of strength is chosen before anything is fitted on top of it.
  //
  // `goalsWeight = 0` is the incumbent, pure expected goals, and is the null candidate under D-023:
  // if the grid is flat, the rebuild earned nothing and the model keeps the definition it had.
  search(
    'strength.goalsWeight',
    [0, 0.25, 0.5, 0.75, 1],
    (p, v) => ({ ...p, strength: { ...p.strength, goalsWeight: v } }),
    'main',
    0,
  );
  search(
    'strength.decayHalfLife',
    [0, 24, 16, 10, 6, 4],
    (p, v) => ({ ...p, strength: { ...p.strength, decayHalfLife: v } }),
    'main',
    0,
  );
  // Grids widened after the first run put three of four winners on an edge.
  search(
    'strength.confidenceMatches',
    [2, 4, 8, 12, 16, 24, 32, 48, 64, 96],
    (p, v) => ({ ...p, strength: { ...p.strength, confidenceMatches: v } }),
  );
  search(
    'attack.xgFixtureElasticity',
    // Widened for B-014: on the rebuilt strength the assist elasticity ran off the top of the old
    // grid at 2, so both are given room above it. A grid that stops where the answer is is the same
    // failure as a flat one — it returns a number that is the edge of the search, not the optimum.
    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4],
    (p, v) => ({ ...p, attack: { ...p.attack, xgFixtureElasticity: v } }),
    'main',
    0,
  );
  search(
    'attack.xaFixtureElasticity',
    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 4],
    (p, v) => ({ ...p, attack: { ...p.attack, xaFixtureElasticity: v } }),
    'main',
    0,
  );
  search(
    'defcon.ratePer90ToMatch',
    [0.5, 0.6, 0.7, 0.8, 0.9, 1, 1.1, 1.2],
    (p, v) => ({ ...p, defcon: { ...p.defcon, ratePer90ToMatch: v } }),
    'defcon',
  );
  // Scored on keeper validation rows only — the parameter cannot touch anyone else, and diluted
  // over the whole field its grid reads flat by construction. 1 is the hand-drawn shape it
  // replaces, and is also the null when the keeper rows cannot tell the grid apart (B-021).
  search(
    'saves.elasticity',
    [0, 0.25, 0.5, 0.75, 1, 1.25, 1.5, 2],
    (p, v) => ({ ...p, saves: { elasticity: v } }),
    'main',
    1,
    'GKP',
  );

  return { params, measured, searched, leagueRates };
}

/**
 * The parameters that are frequencies, not choices. Each is a count over training rows.
 */
function measureDirect(
  rows: HistoryRow[],
  imputed = false,
  halfLife: number = SEASON_HALF_LIFE,
  mode: 'joint' | 'unflagged-base' | 'none' = 'joint',
  startRateShrink = 0,
) {
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

  const wOf = seasonWeights(rows, halfLife);

  for (const r of rows) {
    const w = wOf.get(r.season) ?? 1;
    // A row from a season with no `starts` column is not a non-start — it is a row that cannot
    // speak to this question, and it is excluded from BOTH sides of the frequency rather than
    // counted as a substitute appearance. With imputation on it speaks fractionally instead:
    // weight p to the start side and 1−p to the other, which is the same arithmetic a recorded
    // label already does at p ∈ {0, 1}.
    const evidence = startEvidence(r, imputed);
    if (evidence !== null) {
      const { p } = evidence;
      started += w * p;
      startedMinutes += w * p * r.minutes;
      if (r.minutes >= 60) startedSixty += w * p;
      notStarted += w * (1 - p);
      if (r.minutes > 0) {
        subAppeared += w * (1 - p);
        subMinutes += w * (1 - p) * r.minutes;
        if (r.minutes >= 60) subSixty += w * (1 - p);
      }
    }

    // Same rule for the goals-per-xG ratio: a season without expected goals contributes neither
    // numerator nor denominator, instead of contributing goals against an xG of zero and driving
    // the fitted ratio to infinity.
    if (r.expectedGoals !== null) {
      xg += w * r.expectedGoals;
      goals += w * r.goalsScored;
    }
    if (r.expectedAssists !== null) {
      xa += w * r.expectedAssists;
      assists += w * r.assists;
    }

    // Bonus is only meaningful for players who were on the pitch; including 0-minute rows would drag
    // the fitted line to zero and make every projection's bonus term vanish.
    if (r.minutes > 0) {
      scoredRows++;
      bpsSum += r.bps;
      bonusSum += r.bonus;
      bpsSq += r.bps * r.bps;
      bpsBonus += r.bps * r.bonus;
    }

    if (r.expectedGoals !== null) {
      const key = `${r.season}|${r.round}|${r.fixture}`;
      if (r.wasHome) {
        homeXg.total += r.expectedGoals;
        homeXg.fixtures.add(key);
      } else {
        awayXg.total += r.expectedGoals;
        awayXg.fixtures.add(key);
      }
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
    // fitMinutesCurves for why each is a two-parameter logistic rather than the identity v1 assumed.
    ...fitMinutesCurves(rows, imputed, halfLife, mode, startRateShrink),
  };
}

/**
 * The two minutes curves, fitted the same way, on the same walk.
 *
 * **P(start) is NOT the lagged start rate.** v1 used the lagged rate directly, which assumes a player
 * who started 8 of their last 10 starts the next one with probability 0.8. Realised behaviour is more
 * extreme at both ends — nailed starters regress toward 1, fringe players toward 0 — so a
 * two-parameter logistic on the logit of the lagged rate is fitted instead.
 *
 * **P(appear | did not start) is not one number either, and that was the model's worst shape.**
 * B-013 scored every term of the model on its own and this one carried a Brier reliability of 0.0121
 * against a mean of 0.0012 for the rest: a single global `subAppearanceRate` pays a never-used fringe
 * player and a first substitute the same chance. It gets the identical treatment — a logistic on the
 * logit of the player's own lagged sub rate — and the two are fitted in ONE walk rather than two,
 * because a second walk over 87,000 rows to measure a sibling quantity is pure cost.
 *
 * Both are conditioned strictly: the sub curve reads only rows where the player did NOT start, which
 * is the population it is asked about at prediction time. Fitting it over every row would make it a
 * curve about starting, dressed as a curve about coming on.
 */
function fitMinutesCurves(
  rows: HistoryRow[],
  imputed = false,
  halfLife: number = SEASON_HALF_LIFE,
  mode: 'joint' | 'unflagged-base' | 'none' = 'joint',
  startRateShrink = 0,
): {
  startIntercept: number;
  startSlope: number;
  subIntercept: number;
  subSlope: number;
  /** the same four, fitted on keeper rows alone (B-021), with the n behind each curve */
  gkp: {
    startIntercept: number;
    startSlope: number;
    subIntercept: number;
    subSlope: number;
    n: { start: number; sub: number };
  };
  /** the fitted availability terms (plan 024), joint with the base curves above */
  availability: {
    startInj: number;
    startInjX: number;
    startUnknown: number;
    subInj: number;
    subUnknown: number;
    sixtyGivenStartFlagged: number;
    minutesGivenStartFlagged: number;
    n: {
      startFlagged: number;
      subFlagged: number;
      unknown: number;
      flaggedStarts: number;
    };
  };
} {
  // The joint refit (plan 024). Three populations, split by what the deadline-time flags say:
  //
  //   - RULE rows — status u/n/s or an effective 0% chance. Excluded from every curve: their
  //     outcome is decided by the rule that zeroes them at prediction time, and feeding a
  //     perfectly-predicted population to a logistic is how the 7.3e8 slope happened.
  //   - The FITTED band — everything else with known flags. `inj = 1 − effective chance` enters
  //     the start curve with an interaction against the lagged rate, and the sub curve as a main
  //     effect (the flagged-sub sample cannot support an interaction).
  //   - UNKNOWN rows — no capture inside the staleness bound. They keep their own offset, so the
  //     base curves are not silently averaged over rows whose flags nobody knows.
  const startPoints: { x: number[]; y: number; w: number }[] = [];
  const subPoints: { x: number[]; y: number; w: number }[] = [];
  // Keeper base curves (B-021) keep their own two-parameter fit, on the same filtered population;
  // the availability terms are global — ~5% of rows are flagged, and a per-position flagged sample
  // is too thin to defend.
  const gkpStartPoints: { x: number; y: number; w: number }[] = [];
  const gkpSubPoints: { x: number; y: number; w: number }[] = [];

  let nStartFlagged = 0;
  let nSubFlagged = 0;
  let nUnknown = 0;
  let flaggedStarts = 0;
  let flaggedStartSixty = 0;
  let flaggedStartMinutes = 0;
  // Global starter frequencies over the same (rule-filtered) population — the fallback the flagged
  // group constants collapse to when their sample is too thin to measure.
  let allStarts = 0;
  let allStartSixty = 0;
  let allStartMinutes = 0;

  const curveWeights = seasonWeights(rows, halfLife);

  // The walk the curves are regressed on carries the same start-rate shrinkage the fitted params
  // will (plan 029 task 5); at 0 this is `UNFITTED_PARAMS` exactly.
  const walkParams: FittedParams =
    startRateShrink > 0
      ? {
          ...UNFITTED_PARAMS,
          minutes: { ...UNFITTED_PARAMS.minutes, startRateShrink },
        }
      : UNFITTED_PARAMS;
  for (const context of walkRounds(rows, walkParams)) {
    for (const { row, features } of context.items) {
      if (features.matchesSample === 0) continue;
      const known =
        row.deadlineStatus !== null && row.deadlineStatus !== undefined;
      const sig = known
        ? availabilitySignal(
            row.deadlineStatus as string,
            row.deadlineChance ?? null,
          )
        : null;
      if (sig?.zero) continue;
      // The hybrid (plan 027 task 8). A row carrying ANY doubt is dropped from the base curves, so
      // they describe the players nobody had a question about — and FPL's own chance percentage is
      // then applied multiplicatively at prediction time, which is the shape D-032 measured the
      // joint fit as unable to express. Dropping them is the point: leaving them in makes the base
      // curve an average over two populations, one of which is priced again downstream.
      if (mode === 'unflagged-base' && (sig === null || sig.inj > 0)) continue;
      // The start and sub curves are regressions ON `starts`. A row that does not record it has no
      // label, so it is skipped here rather than labelled 0 — labelling it would put seven seasons
      // of every player into the "did not start" class and drag the fitted intercept with them.
      // With imputation on (plan 027 task 6) such a row carries a PROBABILITY instead, and enters
      // both classes weighted; `p` is 1 or 0 for a recorded label, so the two paths are one.
      const evidence = startEvidence(row, imputed);
      if (evidence === null) continue;
      const p = evidence.p;
      const inj = sig?.inj ?? 0;
      const unknown = known ? 0 : 1;
      if (unknown === 1) nUnknown += 1;
      allStarts += p;
      allStartMinutes += p * row.minutes;
      if (row.minutes >= 60) allStartSixty += p;
      if (inj > 0) {
        nStartFlagged += 1;
        flaggedStarts += p;
        flaggedStartMinutes += p * row.minutes;
        if (row.minutes >= 60) flaggedStartSixty += p;
      }

      const startLogit = logit(features.laggedStartRate);
      const sw = curveWeights.get(row.season) ?? 1;
      // One point per class, weighted by how much of this row belongs to it. At p ∈ {0, 1} the
      // zero-weight point contributes nothing to the likelihood and this is exactly the old
      // single-point push; in between, the row is half a start and half a substitute rather than a
      // coin flip the fit is told to believe.
      const startClasses: { y: number; w: number }[] = [
        { y: 1, w: sw * p },
        { y: 0, w: sw * (1 - p) },
      ];
      for (const { y, w } of startClasses) {
        if (w <= 0) continue;
        startPoints.push({
          x: [startLogit, inj, inj * startLogit, unknown],
          y,
          w,
        });
        if (row.position === 'GKP') {
          gkpStartPoints.push({ x: startLogit, y, w });
        }
      }
      // The substitute curve is conditional on NOT starting, so a row enters it with weight 1−p.
      const subWeight = sw * (1 - p);
      if (subWeight > 0) {
        // Fractionally, like every other count under imputation: a row that is 6% substitute is 0.06
        // of a flagged substitute, not one. At a recorded label this is the old arithmetic exactly —
        // a recorded starter contributes 0 and a recorded non-starter 1 — which is what keeps the
        // flag-off path byte-identical to the fit that shipped.
        if (inj > 0) nSubFlagged += 1 - p;
        subPoints.push({
          x: [logit(features.laggedSubRate), inj, unknown],
          y: row.minutes > 0 ? 1 : 0,
          w: subWeight,
        });
        if (row.position === 'GKP') {
          gkpSubPoints.push({
            w: subWeight,
            x: logit(features.laggedSubRate),
            y: row.minutes > 0 ? 1 : 0,
          });
        }
      }
    }
  }

  // Feature order: [logit(startRate), inj, inj*logit(startRate), unknown]. The fallback keeps the
  // incumbent base curve and zeroes every availability term, so a failed fit degrades to the old
  // behaviour rather than to nonsense.
  const start = fitLogisticK(startPoints, [0, 1, 0, 0, 0]);

  // The sub fallback is the flat curve at the population rate — exactly the constant this replaces.
  const fallbackRate = (points: { y: number }[]) =>
    points.length ? points.reduce((t, p) => t + p.y, 0) / points.length : 0.15;
  // Feature order: [logit(subRate), inj, unknown].
  const sub = fitLogisticK(subPoints, [
    logit(fallbackRate(subPoints)),
    0,
    0,
    0,
  ]);

  const gkpStart = fitLogistic(gkpStartPoints, { intercept: 0, slope: 1 });
  const gkpSub = fitLogistic(gkpSubPoints, {
    intercept: logit(fallbackRate(gkpSubPoints)),
    slope: 0,
  });

  // Group constants for flagged starters. Thin-sample guard: below 200 flagged starts the measured
  // frequency is noise, and the global constants are the honest value.
  const globalSixty = allStarts > 0 ? allStartSixty / allStarts : 0.85;
  const globalMinutes = allStarts > 0 ? allStartMinutes / allStarts : 85;
  const sixtyGivenStartFlagged =
    flaggedStarts >= 200 ? flaggedStartSixty / flaggedStarts : globalSixty;

  return {
    startIntercept: start[0],
    startSlope: start[1],
    subIntercept: sub[0],
    subSlope: sub[1],
    gkp: {
      startIntercept: gkpStart.intercept,
      startSlope: gkpStart.slope,
      subIntercept: gkpSub.intercept,
      subSlope: gkpSub.slope,
      n: { start: gkpStartPoints.length, sub: gkpSubPoints.length },
    },
    availability: {
      startInj: start[2],
      startInjX: start[3],
      startUnknown: start[4],
      subInj: sub[2],
      subUnknown: sub[3],
      sixtyGivenStartFlagged,
      minutesGivenStartFlagged:
        flaggedStarts >= 200
          ? flaggedStartMinutes / flaggedStarts
          : globalMinutes,
      n: {
        startFlagged: nStartFlagged,
        subFlagged: nSubFlagged,
        unknown: nUnknown,
        flaggedStarts,
      },
    },
  };
}

/**
 * K-feature logistic regression by the same damped, ridge-penalised Newton (IRLS) machinery as the
 * two-parameter version below — generalised for the availability terms (plan 024), with the same
 * two guards for the same measured reason: ridge against complete separation, and a coefficient
 * bound past which the "fit" is a step function that no error metric would flag.
 *
 * `x` excludes the intercept; `fallback` includes it — `fallback[0]` is the intercept, then one
 * per feature, and it is returned whole when the fit is unusable.
 */
function fitLogisticK(
  points: { x: number[]; y: number; w?: number }[],
  fallback: number[],
): number[] {
  if (points.length === 0) return fallback;
  const k = fallback.length;
  const RIDGE = 1e-3;
  const beta = [...fallback];
  const xi = (p: { x: number[] }, j: number) => (j === 0 ? 1 : p.x[j - 1]);

  for (let iter = 0; iter < 50; iter++) {
    const g = new Array(k).fill(0);
    const h: number[][] = Array.from({ length: k }, () => new Array(k).fill(0));
    for (const p of points) {
      let z = beta[0];
      for (let j = 1; j < k; j++) z += beta[j] * p.x[j - 1];
      const mu = 1 / (1 + Math.exp(-z));
      const sw = p.w ?? 1;
      const w = sw * mu * (1 - mu);
      const r = sw * (p.y - mu);
      for (let a = 0; a < k; a++) {
        g[a] += r * xi(p, a);
        for (let b = a; b < k; b++) h[a][b] += w * xi(p, a) * xi(p, b);
      }
    }
    for (let a = 0; a < k; a++) {
      g[a] -= RIDGE * beta[a] * points.length;
      h[a][a] += RIDGE * points.length;
      for (let b = 0; b < a; b++) h[a][b] = h[b][a];
    }

    const delta = solveSymmetric(h, g);
    if (delta === null) break;
    // Cap the step so a near-singular Hessian cannot throw the parameters into the millions.
    const step = Math.max(...delta.map((d) => Math.abs(d)));
    if (step > 1) for (let a = 0; a < k; a++) delta[a] /= step;
    let converged = true;
    for (let a = 0; a < k; a++) {
      beta[a] += delta[a];
      if (Math.abs(delta[a]) >= 1e-8) converged = false;
    }
    if (converged) break;
  }

  // Same separation bound as the 2-parameter fit: a coefficient past it is not a fit.
  if (beta.some((b) => !Number.isFinite(b) || Math.abs(b) > 20)) {
    return fallback;
  }
  return beta;
}

/** Gaussian elimination with partial pivoting for the small symmetric Newton system. */
function solveSymmetric(h: number[][], g: number[]): number[] | null {
  const k = g.length;
  const a = h.map((row, i) => [...row, g[i]]);
  for (let col = 0; col < k; col++) {
    let pivot = col;
    for (let r = col + 1; r < k; r++) {
      if (Math.abs(a[r][col]) > Math.abs(a[pivot][col])) pivot = r;
    }
    if (Math.abs(a[pivot][col]) < 1e-12) return null;
    [a[col], a[pivot]] = [a[pivot], a[col]];
    for (let r = 0; r < k; r++) {
      if (r === col) continue;
      const f = a[r][col] / a[col][col];
      for (let c = col; c <= k; c++) a[r][c] -= f * a[col][c];
    }
  }
  const out = new Array(k);
  for (let i = 0; i < k; i++) {
    if (!Number.isFinite(a[i][i]) || Math.abs(a[i][i]) < 1e-12) return null;
    out[i] = a[i][k] / a[i][i];
  }
  return out;
}

/**
 * Two-parameter logistic regression by damped, ridge-penalised Newton steps.
 *
 * Ridge penalty and damped steps, both required rather than tidy. The first run of the start fit
 * returned a slope of 7.3e8 — complete separation. A lagged start rate is very nearly a perfect
 * predictor of the next start, so the unpenalised likelihood keeps improving as the coefficients run
 * to infinity, and Newton obliges. The resulting "model" is a step function: P(start) is exactly 0 or
 * 1, every rotation risk becomes a certainty in one direction or the other, and the MAE barely moves
 * — which is precisely how a broken fit survives an error metric.
 *
 * `fallback` is returned when the fit does not converge to something usable, so the caller always
 * gets a curve it can defend rather than one it has to check.
 */
function fitLogistic(
  points: { x: number; y: number; w?: number }[],
  fallback: { intercept: number; slope: number },
): { intercept: number; slope: number } {
  if (points.length === 0) return fallback;

  const RIDGE = 1e-3;
  let a = fallback.intercept;
  let b = fallback.slope;

  for (let iter = 0; iter < 50; iter++) {
    let g0 = 0;
    let g1 = 0;
    let h00 = 0;
    let h01 = 0;
    let h11 = 0;
    for (const p of points) {
      const z = a + b * p.x;
      const mu = 1 / (1 + Math.exp(-z));
      // The row's season weight multiplies both the gradient and the Hessian, which is what makes
      // this a weighted likelihood rather than an unweighted one with a rescaled step.
      const sw = p.w ?? 1;
      const w = sw * mu * (1 - mu);
      const r = sw * (p.y - mu);
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

  // A slope beyond this is not a fit, it is separation that survived the penalty. Fall back rather
  // than shipping a step function that no error metric would flag.
  if (!Number.isFinite(a) || !Number.isFinite(b) || Math.abs(b) > 20) {
    return fallback;
  }
  return { intercept: a, slope: b };
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
      loss -=
        s.hit * Math.log(clampP(p)) + (1 - s.hit) * Math.log(clampP(1 - p));
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

    // The league xG rate is measured over the rows that RECORD xG and the minutes those rows
    // played — not over every row and every minute. Seasons before 2022-23 have no expected goals,
    // and folding their minutes into the denominator would halve the positional prior that every
    // thin-sample player is shrunk toward.
    const xgRows = played.filter((r) => r.expectedGoals !== null);
    const xgMinutes = xgRows.reduce((s, r) => s + r.minutes, 0);
    out[position] = {
      xg90: per90(
        xgRows.reduce((s, r) => s + (r.expectedGoals ?? 0), 0),
        xgMinutes,
      ),
      xa90: per90(
        xgRows.reduce((s, r) => s + (r.expectedAssists ?? 0), 0),
        xgMinutes,
      ),
      defcon90: per90(
        defconRows.reduce((s, r) => s + (r.defensiveContribution ?? 0), 0),
        defconMinutes,
      ),
      saves90: per90(
        played.reduce((s, r) => s + r.saves, 0),
        minutes,
      ),
      bps90: per90(
        played.reduce((s, r) => s + r.bps, 0),
        minutes,
      ),
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
