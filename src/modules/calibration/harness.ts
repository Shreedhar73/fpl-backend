import { Scoring } from '../projections/scoring';
import { FittedParams } from '../projections/fitted';
import {
  AvailabilityInput,
  availabilityMultiplier,
  FixtureExpectations,
  FixtureProbabilities,
  minutesDistribution,
  projectFixtureV2,
} from '../projections/model-v2';
import { DEFCON_THRESHOLD } from '../projections/points';
import {
  HistoryRow,
  PlayerFeatures,
  ScoredRow,
  walkRounds,
} from '../projections/features';
import { HORIZON_DECAY } from '../optimizer/policy';
import { Observation } from './metrics';
import { exportFeatures } from './feature-export';
import {
  BONUS_POINTS_PER_FIXTURE,
  BonusRanks,
  fixtureBonus,
} from '../projections/bonus-rank';

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
/**
 * `v4` is the gradient-boosted candidate (B-035) and is nullable like every baseline: it exists on
 * a row only when the run was handed the v4 scorers AND the exporter emitted features for that row.
 * The incumbent stays `model` until a D-numbered decision says otherwise — a name is not an adoption.
 */
export const PREDICTORS = ['model', 'form', 'priorSeason', 'v4'] as const;
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
  /**
   * `Σ EP(round + i) × decay^i` over the horizon, or **null** when the run did not ask for one.
   *
   * This is what a transfer decision is actually made on — a transfer is a bet about the future, and
   * a −4 has to be worth more than four points over several rounds, not this one. `predicted.model`
   * is the single round and is what the calibration reports score.
   *
   * **Every term is built from the state before `round`.** The future rounds are scored by
   * `walkRounds`' own horizon, with the accumulators and the form window frozen at this deadline;
   * only the fixture (opponent, home) comes from the future row, because fixtures are published in
   * advance and results are not. Taking the number from a later round's own context instead would
   * read features built from rounds nobody had played yet — the leak that produces no error and
   * nothing wrong-looking in the output.
   *
   * A player with no row in a future round had no fixture — a blank — and contributes 0. A player
   * with two contributes both, which is a double gameweek.
   */
  horizonEp: number | null;
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
  /** null when the season did not record `starts` — the same convention `defcon` already uses */
  started: number | null;
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
  /**
   * An outside forecast, keyed `season|round|playerCode`.
   *
   * Two systems cannot be compared by their own season totals — each brings its own simulator, its
   * own opening fifteen and its own idea of a transfer, so the difference measures all three. This
   * lets a foreign forecast be scored by THIS simulator under the SAME policies, which leaves the
   * model as the only thing that differs. Absent by default; nothing changes when it is not given.
   */
  lab?: Map<string, number>;
  /** rows to predict; anything outside is history the model may read but is never scored on */
  evaluate: (row: HistoryRow) => boolean;
  /**
   * Override for the injury/doubt multiplier, 0 to 1.
   *
   * Since plan 024 the DEFAULT is no longer a flat 1: `HistoryRow` carries the deadline-time flags
   * recovered from the Wayback archive, so params without a fitted availability block get the hand
   * multiplier applied to those flags — the incumbent as it would actually have served — and params
   * WITH the block read the flags directly. A row with no capture (`deadlineStatus` null) falls
   * back to multiplier 1 for the hand rule, and to the fitted unknown offset for the fitted one.
   */
  availability?: (row: HistoryRow) => number;
  /**
   * Rounds to project at each deadline, this one included, for `PredictionRow.horizonEp`.
   *
   * Defaults to 1, which leaves `horizonEp` null: the calibration reports score a single round and
   * paying for four extra feature passes to fill a field nothing reads would be waste. The transfer
   * harness passes `HORIZON`.
   */
  horizon?: number;
  /** Discount on a later round in the horizon sum. Defaults to what the product serves. */
  horizonDecay?: number;
  /**
   * Position → v4 scorer (B-036). When present, every scored row also carries `predicted.v4`,
   * computed from the SAME walk-ordered feature stream the CSV export emits — one time cut, not a
   * reimplementation. Absent, `predicted.v4` is null and every v4 comparison drops out pairwise.
   */
  v4?: ReadonlyMap<
    string,
    {
      predict(f: ReadonlyMap<string, number | null>): number;
      readonly residual: boolean;
    }
  >;
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

  const horizon = Math.max(1, Math.floor(options.horizon ?? 1));
  const decay = options.horizonDecay ?? HORIZON_DECAY;

  // The v4 features come from the same exporter the training CSVs come from — a second walk over
  // the same rows, indexed by the row's natural key. Two walks, ONE implementation of the cut.
  const v4Features = options.v4
    ? indexExportedFeatures(rows, params, scoringFor)
    : null;

  // What the deadline-time flags say about a row, in both regimes: the raw input for fitted
  // params, and the hand multiplier for legacy ones. One place, so the round being scored and the
  // horizon rounds cannot disagree about what availability means.
  const availInput = (row: HistoryRow): AvailabilityInput => ({
    status: row.deadlineStatus ?? 'a',
    chance: row.deadlineChance ?? null,
    known: row.deadlineStatus !== null && row.deadlineStatus !== undefined,
  });
  const legacyMultiplier = (row: HistoryRow): number =>
    options.availability?.(row) ??
    (row.deadlineStatus === null || row.deadlineStatus === undefined
      ? 1
      : availabilityMultiplier(row.deadlineStatus, row.deadlineChance ?? null));
  const minutesFor = (row: HistoryRow, features: PlayerFeatures) =>
    minutesDistribution(
      {
        startRate: features.laggedStartRate,
        subRate: features.laggedSubRate,
        // Read only when `params.minutes.perPlayerStart` says so (B-041); carried always, so the
        // harness and the serving path hand the model the same shape.
        startMinutes: features.startMinutes,
        startSixty: features.startSixty,
      },
      legacyMultiplier(row),
      params,
      row.position,
      availInput(row),
    );

  /**
   * Bonus ranks for one round's fixtures (B-041, plan 028 task 4).
   *
   * A pre-pass, because a rank needs the field: the model cannot compute this player's bonus without
   * the other twenty-one in his match. Built from the SAME minutes distribution and BPS rate the
   * projection then uses, so the two cannot disagree about the player they are both about.
   *
   * Returns an empty map when the params carry no `bonus.tau`, which is the incumbent — the clipped
   * linear term stays and nothing here runs.
   */
  /** Bonus points the rank model issued, and over how many fixtures — checked after the walk. */
  let bonusPointsIssued = 0;
  let bonusFixtures = 0;

  const bonusFor = (items: readonly ScoredRow[]): Map<string, BonusRanks> => {
    const tau = params.bonus.tau;
    const out = new Map<string, BonusRanks>();
    if (tau === undefined) return out;
    const byFixture = new Map<string, ScoredRow[]>();
    for (const item of items) {
      const key = `${item.row.season}|${item.row.round}|${item.row.fixture}`;
      const at = byFixture.get(key);
      if (at) at.push(item);
      else byFixture.set(key, [item]);
    }
    for (const [, group] of byFixture) {
      const candidates = group.map(({ row, features }) => {
        const minutes = minutesFor(row, features);
        return {
          key: row.playerCode,
          pPlay: minutes.pPlay,
          // E[BPS | played], which is what the rank is over — not E[BPS], which would double-count
          // the chance of featuring that already sits in `pPlay`.
          expectedBps:
            ((minutes.pPlay > 0 ? minutes.expectedMinutes / minutes.pPlay : 0) /
              90) *
            features.rates.bps90,
        };
      });
      const fixture = fixtureBonus(candidates, tau);
      // The arithmetic that says the pre-pass actually saw a whole match. A fixture has six bonus
      // points; if the harness were handing this function half a fixture, or dropping the rows it
      // later declines to score, the total would come back short and nothing else would show it.
      // Accumulated rather than asserted per fixture — a genuinely empty fixture returns 0 by design.
      if (fixture.totalExpected > 0) {
        bonusFixtures += 1;
        bonusPointsIssued += fixture.totalExpected;
      }
      const ranks = fixture.ranks;
      for (const item of group) {
        const r = ranks.get(item.row.playerCode);
        if (r) {
          out.set(
            `${item.row.season}|${item.row.round}|${item.row.fixture}|${item.row.playerCode}`,
            r,
          );
        }
      }
    }
    return out;
  };

  // One projection path for the round being scored and for every round in its horizon. Two would be
  // two models, and the horizon one would drift from the one the reports measure.
  const project = (
    row: HistoryRow,
    features: PlayerFeatures,
    goalRates: ScoredRow['goalRates'],
    ranks?: Map<string, BonusRanks>,
  ) =>
    projectFixtureV2(
      row.position,
      minutesFor(row, features),
      features.rates,
      goalRates,
      scoringFor(row.season),
      params,
      ranks?.get(`${row.season}|${row.round}|${row.fixture}|${row.playerCode}`),
    );

  for (const context of walkRounds(rows, params, { horizon })) {
    const roundBonus = bonusFor(context.items);
    // The horizon tail, per player: rounds after this one, discounted, summed over each player's
    // fixtures in them. A player absent from a round had no fixture and contributes nothing.
    const tail = new Map<number, number>();
    for (const [i, ahead] of context.future.entries()) {
      const weight = decay ** (i + 1);
      const aheadBonus = bonusFor(ahead.items);
      for (const { row, features, goalRates } of ahead.items) {
        if (row.teamCode === null || row.opponentTeamCode === null) continue;
        if (features.matchesSample === 0) continue;
        tail.set(
          row.playerCode,
          (tail.get(row.playerCode) ?? 0) +
            weight * project(row, features, goalRates, aheadBonus).ep,
        );
      }
    }

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

      const minutes = minutesFor(row, features);
      const projection = project(row, features, goalRates, roundBonus);

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
          v4: v4Predict(options.v4, v4Features, row),
        },
        pPlay: minutes.pPlay,
        appearances: features.appearancesSample,
        probabilities: projection.probabilities,
        expected: projection.expected,
        realised: realisedOutcomes(row),
        horizonEp:
          horizon > 1 ? projection.ep + (tail.get(row.playerCode) ?? 0) : null,
      });
    }
  }

  // The rank model's own invariant, checked once over the whole run rather than trusted: every
  // fixture it priced must have paid out six bonus points. A shortfall means the pre-pass was handed
  // part of a match — the failure mode that would otherwise look like a slightly worse model.
  if (bonusFixtures > 0) {
    const perFixture = bonusPointsIssued / bonusFixtures;
    if (Math.abs(perFixture - BONUS_POINTS_PER_FIXTURE) > 0.05) {
      throw new Error(
        `the rank-bonus pre-pass issued ${perFixture.toFixed(3)} bonus points per fixture over ` +
          `${bonusFixtures} fixtures, and a fixture has exactly ${BONUS_POINTS_PER_FIXTURE}. It was ` +
          `handed part of a match: the ranks and the rows being scored are not the same field.`,
      );
    }
  }

  return {
    rows: sortRows(out),
    skipped: [...skipped.entries()].map(([reason, n]) => ({ reason, n })),
  };
}

/**
 * One canonical order for every prediction row, applied once here so nothing downstream has to
 * remember to (B-039).
 *
 * **This ordering is data, not presentation.** Three consumers read it:
 *
 *  - `randomLegalSquad()` draws its seeded xorshift stream per row, in row order, so a different
 *    order assigns different weights to different players and the recorded seed stops meaning
 *    anything;
 *  - every `sort()` with a comparator that can return 0 — the XI, the armband, the weekly transfer,
 *    the chip pick, the ordering metrics — resolves its ties to input order, because
 *    `Array.prototype.sort` is stable;
 *  - `buildLp()` emits its variables in array order, so the LP string differs.
 *
 * Measured on 2026-08-28 (plan 026, task 1): two `pnpm decision-quality` runs over an unchanged
 * database returned rows in different orders and disagreed by **165 points** on the `greedy-1ft`
 * `form` arm, flipping the sign of a conclusion the report prints in prose. The opening fifteen was
 * byte-identical across those runs, so sorting inside the squad solve alone would have fixed
 * nothing — the order has to be pinned upstream of every consumer, which is here.
 *
 * The reader's `ORDER BY` is also total (`forecast.repository.ts`). This is deliberately the second
 * of two: a query is one refactor away from losing a clause, and this sort is what keeps that
 * refactor from silently costing 165 points again.
 */
export function sortRows(rows: PredictionRow[]): PredictionRow[] {
  return [...rows].sort(
    (a, b) =>
      a.season.localeCompare(b.season) ||
      a.round - b.round ||
      a.playerCode - b.playerCode ||
      // A double gameweek is two rows for one player in one round; the opponent is what separates
      // them. `PredictionRow` does not carry the fixture id, and does not need to — one player
      // does not face the same opponent twice in one gameweek.
      a.opponentTeamCode - b.opponentTeamCode ||
      Number(b.wasHome) - Number(a.wasHome),
  );
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
    // null, not 0, when the season did not record it: a reliability curve scored against an
    // invented label is confidently about nothing, which is what this function's own header warns of
    started: row.starts === null ? null : row.starts > 0 ? 1 : 0,
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

/** The natural key both walks share. */
const exportKey = (r: {
  season: string;
  round: number;
  fixture: number;
  playerCode: number;
}): string => `${r.season}|${r.round}|${r.fixture}|${r.playerCode}`;

function indexExportedFeatures(
  rows: HistoryRow[],
  params: FittedParams,
  scoringFor: (season: string) => Scoring,
): Map<
  string,
  { position: string; v3ep: number; features: Map<string, number | null> }
> {
  const out = new Map<
    string,
    { position: string; v3ep: number; features: Map<string, number | null> }
  >();
  for (const r of exportFeatures(rows, params, scoringFor)) {
    out.set(exportKey(r), {
      position: r.position,
      v3ep: r.v3ep,
      features: r.features,
    });
  }
  return out;
}

function v4Predict(
  scorers:
    | ReadonlyMap<
        string,
        {
          predict(f: ReadonlyMap<string, number | null>): number;
          readonly residual: boolean;
        }
      >
    | undefined,
  features: Map<
    string,
    { position: string; v3ep: number; features: Map<string, number | null> }
  > | null,
  row: HistoryRow,
): number | null {
  if (!scorers || !features) return null;
  const entry = features.get(exportKey(row));
  if (!entry) return null;
  const scorer = scorers.get(entry.position);
  if (!scorer) return null;
  // A residual model predicts the CORRECTION to the incumbent, not the points (B-037 increment 2).
  // The base is added here, from the same exported row the trees read — one number, one source.
  const raw = scorer.predict(entry.features);
  return scorer.residual ? entry.v3ep + raw : raw;
}
