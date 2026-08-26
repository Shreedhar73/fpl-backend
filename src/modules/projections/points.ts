import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from './scoring';

/**
 * The REALISED points engine — what a player actually scored, from what they actually did.
 *
 * This is the other half of `model.ts`. That one projects expected points from rates; this one adds
 * up points that have already happened. Until B-007 nothing in the project did the second thing, so
 * the projection model had never been checked against FPL's own arithmetic — and fitting rate knobs on
 * top of an unverified adder tunes them to hide an arithmetic bug (`docs/plans/007`, Phase 1).
 *
 * The answer key is upstream: `event/{gw}/live/` gives every player an `explain` block of
 * `{ identifier, points, value }` per fixture, which is the only place the API says *why* a player
 * scored what they scored (`fpl-api-reference`). `points.spec.ts` reproduces all 610 of them.
 *
 * Every points value is read from `scoring_config` (`fpl-domain-rules`), never from a constant here —
 * FPL changed goalkeeper goal scoring and added the defensive-contribution category within two
 * seasons. The ONE exception is the defensive-contribution threshold, which upstream does not publish;
 * see `DEFCON_THRESHOLD`.
 */

/** What a player did in ONE fixture. Field names mirror `PlayerGameweekStat`. */
export interface RealisedStats {
  minutes: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  /**
   * The COUNT of qualifying defensive actions, not the points. Verified against GW1 2026/27: for
   * defenders it equals `clearances_blocks_interceptions + tackles`, and for midfielders and forwards
   * it adds `recoveries`. Reading it as points awards 2 to every player who made a single tackle.
   */
  defensiveContribution: number;
}

/**
 * Qualifying actions needed for the +2, by position.
 *
 * Upstream publishes the POINTS (`game_config.scoring.defensive_contribution` = 2 for DEF/MID/FWD, 0
 * for GKP) but not the THRESHOLD, so unlike every other number in this file it cannot be read from
 * config. It is derived from data instead, and `points.spec.ts` re-derives it from the fixture on
 * every run rather than trusting this table — if FPL moves a threshold, the test fails on the boundary
 * rather than silently mispricing a whole position.
 *
 * From GW1 2026/27, the paid/unpaid split is clean and leaves no room for another value:
 *   DEF — lowest paid 10, highest unpaid 9
 *   MID — lowest paid 12, highest unpaid 11
 *   FWD — nobody reached it (highest unpaid 8)
 *   GKP — the category does not apply; every goalkeeper's count is 0
 *
 * **FWD confirmed 2026-08-26** by the 2025-26 archive (B-007 Phase 2b), which GW1 could not settle:
 * across a full season, forwards at 10 (13 rows) and 11 (7 rows) went unpaid while 12 was paid, and
 * re-scoring all 29,747 rows of that season with this table produced zero disagreements with the
 * official totals. DEF and MID hold there too, on 250/202 and 199/153 rows either side.
 */
export const DEFCON_THRESHOLD: Record<PositionCode, number> = {
  GKP: 0,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

export interface PointsBreakdown {
  total: number;
  /**
   * Keyed by FPL's own `explain` identifier, and following its emission contract so the two can be
   * compared directly: `minutes` is always present even when it scores 0 (all 300 unused players in
   * GW1 carry one), and every other identifier appears only when it is worth something.
   */
  byIdentifier: Record<string, number>;
}

export function pointsFor(
  stats: RealisedStats,
  position: PositionCode,
  scoring: Scoring,
): PointsBreakdown {
  const by: Record<string, number> = {};

  // Appearance. Always emitted, 0 included — a player who did not feature still gets the identifier.
  by.minutes =
    stats.minutes === 0
      ? 0
      : stats.minutes >= 60
        ? scoring.longPlay()
        : scoring.shortPlay();

  add(by, 'goals_scored', stats.goalsScored * scoring.goal(position));
  add(by, 'assists', stats.assists * scoring.assist());

  // The 60-minute rule is already baked into the upstream stat: no player in GW1 had a clean sheet
  // recorded with fewer than 60 minutes. Re-applying it here would double-count the condition.
  add(by, 'clean_sheets', stats.cleanSheets * scoring.cleanSheet(position));

  // Per TWO conceded, rounded down, and only where the position scores it (GKP/DEF). One conceded is
  // worth nothing and upstream omits the identifier entirely.
  add(
    by,
    'goals_conceded',
    Math.floor(stats.goalsConceded / 2) * scoring.goalsConceded(position),
  );

  // Per THREE saves, rounded down.
  add(by, 'saves', Math.floor(stats.saves / 3) * scoring.savePoint());

  add(by, 'own_goals', stats.ownGoals * scoring.ownGoal());
  add(by, 'penalties_saved', stats.penaltiesSaved * scoring.penaltySaved());
  add(by, 'penalties_missed', stats.penaltiesMissed * scoring.penaltyMissed());
  add(by, 'yellow_cards', stats.yellowCards * scoring.yellowCard());
  add(by, 'red_cards', stats.redCards * scoring.redCard());
  add(by, 'bonus', stats.bonus * scoring.bonus());

  const threshold = DEFCON_THRESHOLD[position];
  add(
    by,
    'defensive_contribution',
    threshold > 0 && stats.defensiveContribution >= threshold
      ? scoring.defensiveContribution(position)
      : 0,
  );

  const total = Object.values(by).reduce((a, b) => a + b, 0);
  return { total, byIdentifier: by };
}

/** Upstream emits an identifier only when it is worth something; a 0 is an absent key, not a 0 key. */
function add(by: Record<string, number>, identifier: string, points: number) {
  if (points !== 0) by[identifier] = points;
}
