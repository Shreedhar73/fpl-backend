import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from './scoring';
import { MinutesOutput } from './minutes';

/**
 * Expected points for a player in ONE fixture. The service sums this over a player's fixtures in a
 * gameweek (two in a double, none in a blank) and over the horizon.
 *
 * v1 is a transparent heuristic, not a fitted model: minutes dominate, attacking uses the expected
 * (xG/xA) family not raw outcomes, fixture strength is the API's FDR (1–5, home/away already baked
 * in), and every points value is read from `scoring_config` (`fpl-domain-rules`). The knobs below are
 * first estimates to be calibrated against `ep_next` once the season has enough `data_checked`
 * gameweeks — see `docs/plans/004-projection-model.md`.
 */
export interface RateInputs {
  xg90: number;
  xa90: number;
  defcon90: number; // qualifying defensive actions per 90
  saves90: number;
}

export interface FixtureContext {
  /** difficulty of SCORING (from the opponent's defence), 1 (easy) … 5 (hard). */
  attackDifficulty: number;
  /** difficulty of keeping a clean sheet / not conceding (from the opponent's attack), 1 … 5. */
  defenceDifficulty: number;
}

export interface FixtureProjection {
  ep: number;
  components: Record<string, number>;
}

/** defensive-contribution threshold (qualifying actions in a match) by position, 2025/26. */
const DEFCON_THRESHOLD: Record<PositionCode, number> = {
  GKP: 0,
  DEF: 10,
  MID: 12,
  FWD: 12,
};

export function projectFixture(
  position: PositionCode,
  minutes: MinutesOutput,
  rates: RateInputs,
  fixture: FixtureContext,
  scoring: Scoring,
  expectedBonus: number,
): FixtureProjection {
  const { pPlay, eMinutesIfPlay, pStart } = minutes;
  const minShare = (pPlay * eMinutesIfPlay) / 90; // expected 90-minute shares played
  const attackAdj = attackMultiplier(fixture.attackDifficulty);

  // Appearance: 60+ earns long_play, 1–59 earns short_play.
  const appearance =
    pPlay * (eMinutesIfPlay >= 60 ? scoring.longPlay() : scoring.shortPlay());

  const goals = minShare * rates.xg90 * scoring.goal(position) * attackAdj;
  const assists = minShare * rates.xa90 * scoring.assist() * attackAdj;

  // Clean sheet only counts for a 60+ player; approximate that population with P(start).
  const cs =
    pStart *
    cleanSheetProb(fixture.defenceDifficulty) *
    scoring.cleanSheet(position);

  // Goals conceded: −1 per 2 conceded for GKP/DEF (0 for others via config). 60+ player → P(start).
  const concededPts = scoring.goalsConceded(position);
  const conceded =
    concededPts !== 0
      ? pStart *
        (expectedGoalsConceded(fixture.defenceDifficulty) / 2) *
        concededPts
      : 0;

  // Defensive contribution: +2 at the per-match threshold (0 for GKP via config).
  const dcPts = scoring.defensiveContribution(position);
  const threshold = DEFCON_THRESHOLD[position];
  const defcon =
    dcPts !== 0 && threshold > 0
      ? pPlay *
        defconThresholdProb(rates.defcon90 * (eMinutesIfPlay / 90), threshold) *
        dcPts
      : 0;

  const saves =
    position === 'GKP'
      ? (minShare * rates.saves90 * scoring.savePoint()) / 3
      : 0;
  const bonus = pPlay * expectedBonus;

  const components = {
    appearance,
    goals,
    assists,
    cs,
    conceded,
    defcon,
    saves,
    bonus,
  };
  const ep = Object.values(components).reduce((a, b) => a + b, 0);
  return { ep, components };
}

/** FDR → attacking multiplier: easy fixture lifts, hard fixture damps. diff 1→1.30, 3→1.0, 5→0.70. */
export function attackMultiplier(difficulty: number): number {
  return Math.max(0.2, 1 + (3 - difficulty) * 0.15);
}

/** FDR → P(clean sheet). Easier fixture, likelier. diff 1→~0.49, 3→0.35, 5→~0.21. */
export function cleanSheetProb(difficulty: number): number {
  return clamp01(0.35 - (difficulty - 3) * 0.07);
}

/** FDR → expected goals conceded by this player's team. diff 1→~0.6, 3→1.3, 5→~2.0. */
export function expectedGoalsConceded(difficulty: number): number {
  return Math.max(0.2, 1.3 + (difficulty - 3) * 0.35);
}

/** Rough P(reaching the defensive-contribution threshold) from the expected count in the match. */
export function defconThresholdProb(
  expectedCount: number,
  threshold: number,
): number {
  return clamp01((expectedCount / threshold) * 0.7);
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
