import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from './scoring';
import { DEFCON_THRESHOLD } from './points';
import { expectedFloorDiv, thresholdProbability } from './distributions';
import { cleanSheetProbability, GoalRates } from './strength';
import { FittedParams } from './fitted';

/**
 * Expected points for one player in one fixture — v2.
 *
 * Three things changed from `model.ts`, and only the third is about fitting:
 *
 * 1. **The fixture input is goal rates, not an FDR digit.** λ_for and λ_against come from lagged team
 *    strength (`strength.ts`), computed identically over the archive and the live database. FDR could
 *    never be fitted because history has none.
 * 2. **Non-linear scoring rules are integrated, not evaluated at the mean.** Appearance points mix
 *    P(60+) with P(1–59) instead of thresholding an expected minute count; saves and goals conceded
 *    use `E[floor(X/d)]`; the defensive contribution uses a tail probability instead of a linear ramp.
 *    Each of these is wrong in v1 regardless of any constant, and fitting on top of them would have
 *    tuned the constants to hide them.
 * 3. **The constants come from `fitted.ts`**, with provenance, rather than being written in here.
 *
 * The component names match `points.ts` identifiers, so a projection and a realised score can be
 * compared term by term rather than only in total.
 */

export interface MinutesDistribution {
  pStart: number;
  pSub: number;
  /** P(featuring at all) = pStart + pSub */
  pPlay: number;
  /** P(playing 60 minutes or more) — what the appearance and clean-sheet rules actually ask */
  pSixtyPlus: number;
  expectedMinutes: number;
}

export interface PlayerRates {
  xg90: number;
  xa90: number;
  defcon90: number;
  saves90: number;
  /** BPS per 90, for the bonus term that replaces v1's attacking-output placeholder */
  bps90: number;
}

export interface FixtureProjectionV2 {
  ep: number;
  components: Record<string, number>;
}

export function projectFixtureV2(
  position: PositionCode,
  minutes: MinutesDistribution,
  rates: PlayerRates,
  goals: GoalRates,
  scoring: Scoring,
  params: FittedParams,
): FixtureProjectionV2 {
  const ninetieths = minutes.expectedMinutes / 90;

  // --- Appearance. v1 asked `E[minutes] >= 60 ? 2 : 1`, which pays a rotation risk like a certainty.
  const pShort = Math.max(0, minutes.pPlay - minutes.pSixtyPlus);
  const appearance =
    minutes.pSixtyPlus * scoring.longPlay() + pShort * scoring.shortPlay();

  // --- Attacking. The fixture lifts or damps output multiplicatively; the elasticity says how much
  // of a team-level advantage reaches an individual, which is a fitted question, not an assumed 1.
  const attackFactor = Math.pow(
    Math.max(0.01, goals.attackAdjustment),
    params.attack.xgFixtureElasticity,
  );
  const assistFactor = Math.pow(
    Math.max(0.01, goals.attackAdjustment),
    params.attack.xaFixtureElasticity,
  );

  const expectedGoals =
    ninetieths * rates.xg90 * attackFactor * params.attack.goalsPerXg;
  const expectedAssists =
    ninetieths * rates.xa90 * assistFactor * params.attack.assistsPerXa;

  const goalPoints = expectedGoals * scoring.goal(position);
  const assistPoints = expectedAssists * scoring.assist();

  // --- Clean sheet. Requires 60+ minutes, and P(no goal) falls out of the same lambda that prices
  // conceding — so the two terms can no longer contradict each other the way two hand-drawn FDR
  // curves could.
  const csPoints =
    minutes.pSixtyPlus *
    cleanSheetProbability(goals.lambdaAgainst) *
    scoring.cleanSheet(position);

  // --- Goals conceded: -1 per TWO conceded, so E[floor(X/2)], not E[X]/2.
  const concededUnit = scoring.goalsConceded(position);
  const concededPoints =
    concededUnit !== 0
      ? minutes.pSixtyPlus *
        expectedFloorDiv(goals.lambdaAgainst, 2) *
        concededUnit
      : 0;

  // --- Saves: 1 per THREE saves. Same defect, same fix. Saves scale with what the opponent creates,
  // so the fixture's lambda-against carries the shot volume.
  const savePoints =
    position === 'GKP'
      ? expectedFloorDiv(saveRate(rates, ninetieths, goals), 3) *
        scoring.savePoint()
      : 0;

  // --- Defensive contribution: a tail probability, not a linear ramp. The ramp over-paid exactly the
  // high-rate players who make up the premium head this whole entry exists to explain.
  const threshold = DEFCON_THRESHOLD[position];
  const defconUnit = scoring.defensiveContribution(position);
  const defconPoints =
    threshold > 0 && defconUnit !== 0
      ? thresholdProbability(
          rates.defcon90 * ninetieths * params.defcon.ratePer90ToMatch,
          threshold,
          params.defcon.dispersion,
        ) * defconUnit
      : 0;

  // --- Bonus, from BPS rather than from attacking output. Only three players in a match get any, so
  // the relationship saturates and the cap is part of the model, not a safety rail.
  const expectedBps = ninetieths * rates.bps90;
  const bonusPoints =
    minutes.pPlay *
    Math.min(
      params.bonus.maxBonus,
      Math.max(
        0,
        params.bonus.bpsIntercept + params.bonus.bonusPerBps * expectedBps,
      ),
    ) *
    scoring.bonus();

  const components = {
    minutes: appearance,
    goals_scored: goalPoints,
    assists: assistPoints,
    clean_sheets: csPoints,
    goals_conceded: concededPoints,
    saves: savePoints,
    defensive_contribution: defconPoints,
    bonus: bonusPoints,
  };

  return {
    ep: Object.values(components).reduce((a, b) => a + b, 0),
    components,
  };
}

/**
 * Expected saves in the fixture.
 *
 * A keeper's own per-90 rate carries most of it, but the opponent's attacking output moves shot
 * volume, so the rate is scaled by how threatening this fixture is relative to an average one.
 */
function saveRate(
  rates: PlayerRates,
  ninetieths: number,
  goals: GoalRates,
): number {
  const pressure =
    goals.lambdaAgainst > 0 && goals.lambdaFor > 0
      ? Math.max(0.3, Math.min(2.5, goals.lambdaAgainst / 1.4))
      : 1;
  return ninetieths * rates.saves90 * pressure;
}

/**
 * Turn a lagged start rate into the minutes distribution the projection needs.
 *
 * `availability` is the injury/doubt multiplier and stays HEURISTIC on purpose: the archive carries no
 * per-gameweek `status` or `chance_of_playing_next_round`, so this half of the model cannot be fitted
 * from history at all. It waits on `player_deadline_snapshot` accumulating live gameweeks (B-007
 * Phase 2). Anything that reports this model as fitted must say which half.
 */
export function minutesDistribution(
  laggedStartRate: number,
  availability: number,
  params: FittedParams,
): MinutesDistribution {
  const m = params.minutes;
  const rawStart = logistic(m.startIntercept + m.startSlope * logit(laggedStartRate));

  const pStart = clamp01(availability * rawStart);
  const pSub = clamp01(availability * (1 - rawStart) * m.subAppearanceRate);
  const pPlay = clamp01(pStart + pSub);
  const pSixtyPlus = clamp01(
    pStart * m.sixtyGivenStart + pSub * m.sixtyGivenSub,
  );
  const expectedMinutes =
    pStart * m.minutesGivenStart + pSub * m.minutesGivenSub;

  return { pStart, pSub, pPlay, pSixtyPlus, expectedMinutes };
}

function logistic(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

/** Guarded logit, so a 0 or 1 start rate does not produce an infinity. */
function logit(p: number): number {
  const q = Math.min(0.999, Math.max(0.001, p));
  return Math.log(q / (1 - q));
}

function clamp01(x: number): number {
  return Math.max(0, Math.min(1, x));
}
