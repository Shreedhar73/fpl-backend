import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import {
  minutesDistribution,
  projectFixtureV2,
} from '../projections/model-v2';
import { HistoryRow, walkRounds } from './features';
import { Observation } from './metrics';

/**
 * Runs a model over history and collects what it predicted beside what happened.
 *
 * The harness never writes a projection anywhere (B-007 plan invariant 1): a backtest row landing in
 * `projections` becomes the newest by `createdAt`, so it would be served as the current model version
 * and the optimiser would then find nothing for the next gameweek. Results live in memory and reach
 * disk only as a report.
 *
 * Baselines are computed on the SAME rows in the same pass, because a baseline scored over a different
 * population is not a comparison. `epNext` is absent by construction here — the archive's `xP` is
 * post-match contaminated and is not stored — so archive runs compare against `form` and last season's
 * points per 90 only, and say so.
 */

export interface RunOptions {
  /** rows to predict; anything outside is history the model may read but is never scored on */
  evaluate: (row: HistoryRow) => boolean;
  /**
   * Rows the model may not read at all. Used to hold a season out of the FIT while still letting the
   * harness score it — without this, "fit on 2023-24 and evaluate on 2025-26" silently lets 2024-25's
   * second half inform a 2025-26 prediction, which is legitimate, and lets the evaluated season inform
   * itself, which is not.
   */
  availability?: (row: HistoryRow) => number;
}

export interface RunResult {
  model: Observation[];
  baselineForm: Observation[];
  baselinePriorSeason: Observation[];
  /** rows that could not be scored, and why — never silently dropped from a mean */
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
  const model: Observation[] = [];
  const baselineForm: Observation[] = [];
  const baselinePriorSeason: Observation[] = [];
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

      const goals = goalRates;
      // The archive has no per-gameweek availability, so every row is treated as available. This is
      // the honest ceiling of an archive backtest, not an oversight: the injury/doubt multiplier can
      // only be validated once `player_deadline_snapshot` has live gameweeks in it.
      const availability = options.availability?.(row) ?? 1;
      const minutes = minutesDistribution(
        features.laggedStartRate,
        availability,
        params,
      );
      const projection = projectFixtureV2(
        row.position,
        minutes,
        features.rates,
        goals,
        scoringFor(row.season),
        params,
      );

      const observation = (predicted: number): Observation => ({
        predicted,
        actual: row.totalPoints,
        position: row.position,
        value: row.value,
        season: row.season,
        round: row.round,
      });

      model.push(observation(projection.ep));
      if (features.form !== null) baselineForm.push(observation(features.form));
      else skip('no form baseline (fewer than one trailing round)');
      if (features.priorSeasonPointsPer90 !== null) {
        baselinePriorSeason.push(
          observation(features.priorSeasonPointsPer90),
        );
      } else skip('no prior-season baseline (under 450 minutes last season)');
    }
  }

  return {
    model,
    baselineForm,
    baselinePriorSeason,
    skipped: [...skipped.entries()].map(([reason, n]) => ({ reason, n })),
  };
}
