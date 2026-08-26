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

/**
 * The probabilities the model computes on its way to a mean, kept rather than discarded.
 *
 * Every one of these has a realised counterpart in the archive, so each can be scored on its own with
 * a reliability curve and a Brier score (B-013). Until this existed the model was measurable only in
 * aggregate, and an error in one term was invisible against the others.
 *
 * `bonusAtLeastOne` is the one entry here the model does not natively hold. It is DERIVED from the
 * expected bonus on the identity `P(bonus >= 1) = E[bonus] / E[bonus | bonus >= 1]`, with the
 * conditional mean taken as exactly 2 — the three recipients of a match's bonus receive 3, 2 and 1,
 * so an award, given there is one, averages 2. It is evidence about the SHAPE of the bonus term and
 * is never served to anyone as a probability.
 */
export interface FixtureProbabilities {
  start: number;
  play: number;
  sixtyPlus: number;
  /** P(credited with a clean sheet) — needs the 60 minutes AND the shut-out, as FPL scores it */
  cleanSheet: number;
  /** P(reaching the positional defensive-contribution threshold); 0 where the position has none */
  defcon: number;
  bonusAtLeastOne: number;
}

/** The count terms' expectations, in counts rather than in points. */
export interface FixtureExpectations {
  goals: number;
  assists: number;
  saves: number;
  conceded: number;
  bonus: number;
  bps: number;
  defconActions: number;
  minutes: number;
}

export interface FixtureProjectionV2 {
  ep: number;
  components: Record<string, number>;
  /** what the model believed, term by term — scored by B-013, ignored by the points sum */
  probabilities: FixtureProbabilities;
  expected: FixtureExpectations;
}

/** E[bonus | bonus >= 1]. The three awards in a match are 3, 2 and 1. */
export const MEAN_BONUS_GIVEN_ANY = 2;

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
  const pCleanSheet =
    minutes.pSixtyPlus * cleanSheetProbability(goals.lambdaAgainst);
  const csPoints = pCleanSheet * scoring.cleanSheet(position);

  // --- Goals conceded: -1 per TWO conceded, so E[floor(X/2)], not E[X]/2.
  const concededUnit = scoring.goalsConceded(position);
  const expectedConcededPenalties = expectedFloorDiv(goals.lambdaAgainst, 2);
  const concededPoints =
    concededUnit !== 0
      ? minutes.pSixtyPlus * expectedConcededPenalties * concededUnit
      : 0;

  // --- Saves: 1 per THREE saves. Same defect, same fix. Saves scale with what the opponent creates,
  // so the fixture's lambda-against carries the shot volume.
  const expectedSaves =
    position === 'GKP' ? saveRate(rates, ninetieths, goals) : 0;
  const savePoints =
    position === 'GKP'
      ? expectedFloorDiv(expectedSaves, 3) * scoring.savePoint()
      : 0;

  // --- Defensive contribution: a tail probability, not a linear ramp. The ramp over-paid exactly the
  // high-rate players who make up the premium head this whole entry exists to explain.
  const threshold = DEFCON_THRESHOLD[position];
  const defconUnit = scoring.defensiveContribution(position);
  const expectedDefconActions =
    rates.defcon90 * ninetieths * params.defcon.ratePer90ToMatch;
  const pDefcon =
    threshold > 0
      ? thresholdProbability(
          expectedDefconActions,
          threshold,
          params.defcon.dispersion,
        )
      : 0;
  const defconPoints = defconUnit !== 0 ? pDefcon * defconUnit : 0;

  // --- Bonus, from BPS rather than from attacking output. Only three players in a match get any, so
  // the relationship saturates and the cap is part of the model, not a safety rail.
  const expectedBps = ninetieths * rates.bps90;
  const expectedBonus =
    minutes.pPlay *
    Math.min(
      params.bonus.maxBonus,
      Math.max(
        0,
        params.bonus.bpsIntercept + params.bonus.bonusPerBps * expectedBps,
      ),
    );
  const bonusPoints = expectedBonus * scoring.bonus();

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
    probabilities: {
      start: minutes.pStart,
      play: minutes.pPlay,
      sixtyPlus: minutes.pSixtyPlus,
      cleanSheet: pCleanSheet,
      defcon: pDefcon,
      bonusAtLeastOne: Math.max(
        0,
        Math.min(1, expectedBonus / MEAN_BONUS_GIVEN_ANY),
      ),
    },
    expected: {
      goals: expectedGoals,
      assists: expectedAssists,
      saves: expectedSaves,
      // FPL counts goals conceded WHILE THE PLAYER WAS ON THE PITCH, so the expectation scales
      // with expected minutes rather than with P(60+).
      conceded: ninetieths * goals.lambdaAgainst,
      bonus: expectedBonus,
      bps: minutes.pPlay * expectedBps,
      defconActions: expectedDefconActions,
      minutes: minutes.expectedMinutes,
    },
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
 * What the minutes model is allowed to know about a player before the round it is predicting.
 *
 * Both rates come out of `walkRounds`, which computes them before folding the round in — the
 * structural guarantee against reading the future belongs to the feature engine, and this shape only
 * has to carry them across.
 */
export interface LaggedMinutes {
  /** starts / matches so far, season first and career behind */
  startRate: number;
  /** appearances-off-the-bench / non-starts so far, smoothed toward the population prior */
  subRate: number;
}

/**
 * Turn a player's lagged minutes record into the minutes distribution the projection needs.
 *
 * `availability` is the injury/doubt multiplier and stays HEURISTIC on purpose: the archive carries no
 * per-gameweek `status` or `chance_of_playing_next_round`, so this half of the model cannot be fitted
 * from history at all. It waits on `player_deadline_snapshot` accumulating live gameweeks (B-007
 * Phase 2). Anything that reports this model as fitted must say which half.
 */
export function minutesDistribution(
  lagged: LaggedMinutes,
  availability: number,
  params: FittedParams,
): MinutesDistribution {
  const m = params.minutes;
  const rawStart = logistic(
    m.startIntercept + m.startSlope * logit(lagged.startRate),
  );
  // P(appear | did not start), from the player's OWN lagged rate rather than one league-wide
  // constant. B-013 measured that constant as the model's worst-calibrated shape by a factor of ten.
  const rawSub = logistic(m.subIntercept + m.subSlope * logit(lagged.subRate));

  const pStart = clamp01(availability * rawStart);
  const pSub = clamp01(availability * (1 - rawStart) * rawSub);
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
