import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import {
  FixtureExpectations,
  FixtureProbabilities,
  minutesDistribution,
  projectFixtureV2,
} from '../projections/model-v2';
import { DEFCON_THRESHOLD } from '../projections/points';
import { HistoryRow, walkRounds } from '../projections/features';
import { Observation } from './metrics';

/**
 * Runs a model over history and collects what it predicted beside what happened.
 *
 * The harness never writes a projection anywhere (B-007 plan invariant 1): a backtest row landing in
 * `projections` becomes the newest by `createdAt`, so it would be served as the current model version
 * and the optimiser would then find nothing for the next gameweek. Results live in memory and reach
 * disk only as a report.
 *
 * **One row per player-round, carrying every predictor, and this is the point of the shape.** The
 * harness used to push the model and each baseline into three parallel arrays, skipping a row from a
 * baseline's array whenever that baseline could not produce a number — which is how B-007's headline
 * came to compare the model at n=29,482 with `form` at n=28,905. `form` cannot score a row with no
 * trailing round: a season debut, a return from a long injury, a new signing. Those are the hardest
 * rows in the corpus, and dropping them from one side only turns part of the comparison into
 * bookkeeping. With one row carrying all of them, the intersection is a filter rather than a
 * reconstruction, and the rows that fall out can be described instead of merely counted (B-012).
 *
 * `epNext` is absent by construction here — the archive's `xP` is post-match contaminated and is not
 * stored — so archive runs compare against `form` and last season's points per 90 only, and say so.
 */

/** The predictors the harness scores. Adding one here is what makes it appear in every comparison. */
export const PREDICTORS = ['model', 'form', 'priorSeason'] as const;
export type Predictor = (typeof PREDICTORS)[number];

/**
 * What every predictor said about one player in one round, beside what happened.
 *
 * `null` means *this predictor could not produce a number for this row*, which is different from
 * predicting zero and must never be silently read as one.
 */
export interface PredictionRow {
  season: string;
  round: number;
  playerCode: number;
  webName: string;
  position: string;
  teamCode: number | null;
  /**
   * Who they faced, and where. Fixture data, not outcome data: the fixture list is public weeks
   * before a deadline, so carrying it on the row leaks nothing.
   *
   * Here so the replay harness can price B-011's collisions over an archived round — a collision is
   * "our attacker against our defender in the same match", and without the opponent there is no way
   * to know which of our players are on opposite sides of one. `runBacktest` already refuses any row
   * whose team or opponent is null, so both are non-null by the time a row exists.
   */
  opponentTeamCode: number;
  wasHome: boolean;
  /** price in tenths, that round */
  value: number;
  actual: number;
  /** realised minutes — what auto-substitution turns on, so the decision phases need it here */
  minutes: number;
  predicted: Record<Predictor, number | null>;
  /**
   * The model's P(featuring at all), for bench order.
   *
   * A bench is ordered by `pPlay × EP` (`fpl-optimizer`) — an 8-point projection from a player with
   * a 40% chance of appearing is worth less on a bench than a 3-point projection from a nailed one,
   * because a bench player only ever scores if they come on. The harness used to discard the minutes
   * distribution the moment EP was composed from it.
   *
   * **Model-only, and that asymmetry is deliberate.** `form` and last season's points-per-90 are
   * scalars with no notion of appearance probability, so they order their benches by their own
   * predicted points — which is all they have. Inventing a `pPlay` for them would be handing a
   * baseline a component of our model and then reporting that we beat it.
   */
  pPlay: number;
  /**
   * Premier League appearances before this round, accumulated by the walk.
   *
   * B-010's appearance floor is defined on this count, and a backtest cannot take it from
   * `OptimizerRepository.appearanceCounts()`: that reads current state, so a squad built at round 1
   * of a past season would be told how often each player *would go on to* feature.
   */
  appearances: number;
  /**
   * What the model believed term by term, and what actually happened to each of those terms.
   *
   * Carried on the row rather than recomputed later, because the only place the probabilities exist
   * is inside the projection call — recomputing them elsewhere is a second implementation of the
   * model that can drift from the one being measured, which is the failure mode B-013 is about.
   *
   * The aggregate `predicted.model` is a sum over these. A report that scores only the sum cannot
   * tell a wrongly shaped component from a wrong overall level.
   */
  probabilities: FixtureProbabilities;
  expected: FixtureExpectations;
  realised: RealisedOutcomes;
}

/**
 * The realised counterpart of every probability and expectation the model emits.
 *
 * `defcon` and `defconActions` are `null` in seasons where the defensive-contribution category did
 * not exist. Null rather than 0: a season with no category is not a season where nobody reached the
 * threshold, and scoring those rows as misses would convict the term of an error the data cannot
 * support.
 */
export interface RealisedOutcomes {
  started: number;
  played: number;
  sixtyPlus: number;
  cleanSheet: number;
  defcon: number | null;
  bonusAtLeastOne: number;
  goals: number;
  assists: number;
  saves: number;
  conceded: number;
  bonus: number;
  bps: number;
  defconActions: number | null;
  minutes: number;
}

export interface RunOptions {
  /** rows to predict; anything outside is history the model may read but is never scored on */
  evaluate: (row: HistoryRow) => boolean;
  /**
   * The injury/doubt multiplier, 0 to 1. Defaults to 1 — fully available — because the archive
   * carries no per-gameweek `status` or `chance_of_playing`. That is the honest ceiling of an archive
   * backtest, and the hook exists so a live run can supply the real thing once
   * `player_deadline_snapshot` has gameweeks in it.
   */
  availability?: (row: HistoryRow) => number;
}

export interface RunResult {
  rows: PredictionRow[];
  /** rows that could not be scored at all, and why — never silently dropped from a mean */
  skipped: { reason: string; n: number }[];
}

export function runBacktest(
  rows: HistoryRow[],
  params: FittedParams,
  /**
   * Per SEASON, never one table for the whole run. Found while fitting: scoring 2023-24 and 2024-25
   * with the current table gives every player a defensive-contribution term in seasons where the
   * category did not exist, so the model learns to predict points that could not be scored — and the
   * fit answers by shrinking that term toward zero in the one season where it is real.
   */
  scoringFor: (season: string) => Scoring,
  options: RunOptions,
): RunResult {
  const out: PredictionRow[] = [];
  const skipped = new Map<string, number>();
  const skip = (reason: string) =>
    skipped.set(reason, (skipped.get(reason) ?? 0) + 1);

  for (const context of walkRounds(rows, params)) {
    for (const { row, features, goalRates } of context.items) {
      if (!options.evaluate(row)) continue;

      // A player the model has never seen in any form is not a prediction, it is a guess about a
      // stranger. Counted and named rather than scored — including them flatters or punishes the
      // model for something it was never given the inputs to do.
      if (features.matchesSample === 0) {
        skip('no prior appearance for this player');
        continue;
      }
      if (row.teamCode === null || row.opponentTeamCode === null) {
        skip('fixture missing a team code');
        continue;
      }

      // The archive has no per-gameweek availability, so every row is treated as available. This is
      // the honest ceiling of an archive backtest, not an oversight: the injury/doubt multiplier can
      // only be validated once `player_deadline_snapshot` has live gameweeks in it.
      const availability = options.availability?.(row) ?? 1;
      const minutes = minutesDistribution(
        {
          startRate: features.laggedStartRate,
          subRate: features.laggedSubRate,
        },
        availability,
        params,
      );
      const projection = projectFixtureV2(
        row.position,
        minutes,
        features.rates,
        goalRates,
        scoringFor(row.season),
        params,
      );

      out.push({
        season: row.season,
        round: row.round,
        playerCode: row.playerCode,
        webName: row.webName,
        position: row.position,
        teamCode: row.teamCode,
        opponentTeamCode: row.opponentTeamCode,
        wasHome: row.wasHome,
        value: row.value,
        actual: row.totalPoints,
        minutes: row.minutes,
        predicted: {
          model: projection.ep,
          form: features.form,
          priorSeason: features.priorSeasonPointsPer90,
        },
        pPlay: minutes.pPlay,
        appearances: features.appearancesSample,
        probabilities: projection.probabilities,
        expected: projection.expected,
        realised: realisedOutcomes(row),
      });
    }
  }

  return {
    rows: out,
    skipped: [...skipped.entries()].map(([reason, n]) => ({ reason, n })),
  };
}

/**
 * The rows every listed predictor could score.
 *
 * This is the population every comparison in a report runs on (B-012 invariant 3). A baseline scored
 * over a different population is not a comparison, and the difference is not small or random: the
 * rows `form` cannot reach are debuts and returns, which score differently from the rest.
 */
export function commonRows(
  rows: PredictionRow[],
  predictors: readonly Predictor[] = PREDICTORS,
): PredictionRow[] {
  return rows.filter((r) => predictors.every((p) => r.predicted[p] !== null));
}

/** The complement of `commonRows` — the rows the restriction costs, kept so they can be described. */
export function excludedRows(
  rows: PredictionRow[],
  predictors: readonly Predictor[] = PREDICTORS,
): PredictionRow[] {
  return rows.filter((r) => predictors.some((p) => r.predicted[p] === null));
}

/**
 * One predictor's rows as `Observation`s.
 *
 * Rows the predictor could not score are dropped here rather than coerced to 0 — a predictor that
 * has nothing to say has not said zero. Pass rows through `commonRows` first when comparing.
 */
export function observationsFor(
  rows: PredictionRow[],
  predictor: Predictor,
): Observation[] {
  const out: Observation[] = [];
  for (const r of rows) {
    const p = r.predicted[predictor];
    if (p === null) continue;
    out.push({
      predicted: p,
      actual: r.actual,
      position: r.position,
      value: r.value,
      season: r.season,
      round: r.round,
      playerCode: r.playerCode,
      webName: r.webName,
      teamCode: r.teamCode,
    });
  }
  return out;
}

/**
 * Read a history row as the outcomes the model's own terms are about.
 *
 * Every field here is the definitional counterpart of a probability or an expectation in
 * `FixtureProbabilities` / `FixtureExpectations`, and the mapping is the load-bearing part: FPL
 * credits a clean sheet only to a player who was on for 60 minutes, so `cleanSheets > 0` is the
 * right counterpart of `pSixtyPlus × P(shut-out)` and NOT of the shut-out alone. Getting that pairing
 * wrong produces a reliability curve that is confidently about nothing.
 */
export function realisedOutcomes(row: HistoryRow): RealisedOutcomes {
  const threshold = DEFCON_THRESHOLD[row.position];
  return {
    started: row.starts > 0 ? 1 : 0,
    played: row.minutes > 0 ? 1 : 0,
    sixtyPlus: row.minutes >= 60 ? 1 : 0,
    cleanSheet: row.cleanSheets > 0 ? 1 : 0,
    defcon:
      row.defensiveContribution === null || threshold <= 0
        ? null
        : row.defensiveContribution >= threshold
          ? 1
          : 0,
    bonusAtLeastOne: row.bonus >= 1 ? 1 : 0,
    goals: row.goalsScored,
    assists: row.assists,
    saves: row.saves,
    conceded: row.goalsConceded,
    bonus: row.bonus,
    bps: row.bps,
    defconActions: row.defensiveContribution,
    minutes: row.minutes,
  };
}
