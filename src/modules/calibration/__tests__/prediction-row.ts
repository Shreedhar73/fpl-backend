import { PredictionRow, RealisedOutcomes } from '../harness';
import {
  FixtureExpectations,
  FixtureProbabilities,
} from '../../projections/model-v2';

/**
 * A `PredictionRow` for tests that are not about the per-term detail.
 *
 * The ordering and season-simulation specs care about `predicted`, `actual`, `minutes` and `pPlay`.
 * They still have to construct the whole row, and the per-term detail B-013 added is a dozen fields
 * of noise in a fixture whose point is a two-line comparison. Neutral defaults live here so those
 * specs keep saying what they are about, and so a later field addition is one edit rather than one
 * per spec.
 *
 * Deliberately NOT exported from `harness.ts`: a production module that ships test defaults is one
 * import away from a caller getting a zeroed probability that looks like a measurement.
 */
export const NEUTRAL_PROBABILITIES: FixtureProbabilities = {
  start: 0,
  play: 0,
  sixtyPlus: 0,
  cleanSheet: 0,
  defcon: 0,
  bonusAtLeastOne: 0,
};

export const NEUTRAL_EXPECTATIONS: FixtureExpectations = {
  goals: 0,
  assists: 0,
  saves: 0,
  conceded: 0,
  bonus: 0,
  bps: 0,
  defconActions: 0,
  minutes: 0,
};

export const NEUTRAL_REALISED: RealisedOutcomes = {
  started: 0,
  played: 0,
  sixtyPlus: 0,
  cleanSheet: 0,
  defcon: null,
  bonusAtLeastOne: 0,
  goals: 0,
  assists: 0,
  saves: 0,
  conceded: 0,
  bonus: 0,
  bps: 0,
  defconActions: null,
  minutes: 0,
};

export const predictionRow = (over: Partial<PredictionRow>): PredictionRow => ({
  season: '2025-26',
  round: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  // Team 1 at home to team 2 by default. A fixture a spec does not care about still has to be a
  // fixture: an opponent equal to the team would make every player collide with their own side.
  opponentTeamCode: 2,
  wasHome: true,
  value: 50,
  actual: 0,
  minutes: 0,
  predicted: { model: 0, form: 0, priorSeason: 0, v4: null },
  pPlay: 1,
  appearances: 10,
  horizonEp: null,
  probabilities: NEUTRAL_PROBABILITIES,
  expected: NEUTRAL_EXPECTATIONS,
  realised: NEUTRAL_REALISED,
  ...over,
});
