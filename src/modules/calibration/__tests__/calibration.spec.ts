import {
  expectedFloorDiv,
  poissonTail,
  thresholdProbability,
} from '../../projections/distributions';
import {
  buildLeague,
  cleanSheetProbability,
  fixtureGoalRates,
  StrengthInputRow,
} from '../../projections/strength';
import {
  seasonRoundCut,
  withinSeasonRoundCut,
} from '../../projections/backtest';
import { HistoryRow, walkRounds } from '../../projections/features';
import { UNFITTED_PARAMS, FITTED_PARAMS } from '../../projections/fitted';
import { minutesDistribution, projectFixtureV2 } from '../../projections/model-v2';
import { Scoring, RawScoring } from '../../projections/scoring';
import { calibrationCurve, errorStats } from '../metrics';

/**
 * Tests for the model the archive made possible (B-007 Phases 3 and 4).
 *
 * The ones that matter most are not the arithmetic — they are the two that would let a broken
 * backtest report a good number: the season-round cut, and the guarantee that a round's own rows are
 * invisible while it is being predicted.
 */

const SCORING: RawScoring = {
  long_play: 2,
  short_play: 1,
  goals_scored: { GKP: 10, DEF: 6, MID: 5, FWD: 4 },
  clean_sheets: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
  goals_conceded: { GKP: -1, DEF: -1, MID: 0, FWD: 0 },
  defensive_contribution: { GKP: 0, DEF: 2, MID: 2, FWD: 2 },
  assists: 3,
  saves: 1,
  bonus: 1,
  own_goals: -2,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
};
const scoring = Scoring.from(SCORING);

describe('the cross-season time cut', () => {
  it('admits every earlier season and only earlier rounds of the current one', () => {
    const target = { season: '2024-25', round: 5 };
    expect(withinSeasonRoundCut({ season: '2023-24', round: 38 }, target)).toBe(true);
    expect(withinSeasonRoundCut({ season: '2024-25', round: 4 }, target)).toBe(true);
    expect(withinSeasonRoundCut({ season: '2024-25', round: 5 }, target)).toBe(false);
    expect(withinSeasonRoundCut({ season: '2024-25', round: 6 }, target)).toBe(false);
    expect(withinSeasonRoundCut({ season: '2025-26', round: 1 }, target)).toBe(false);
  });

  it('does not let a later season in through a lower round number', () => {
    // The single-season filter compares round numbers alone, which would admit 2025-26 GW1 when
    // predicting 2024-25 GW5. That is the leak this filter exists for.
    const kept = seasonRoundCut(
      [
        { season: '2023-24', round: 30 },
        { season: '2025-26', round: 1 },
      ],
      { season: '2024-25', round: 5 },
    );
    expect(kept).toEqual([{ season: '2023-24', round: 30 }]);
  });
});

describe('distributions', () => {
  it('takes the expectation of the floor, not the floor of the expectation', () => {
    // A keeper facing 2 expected saves: the mean says 2/3 of a point, the truth is about half that.
    const naive = 2 / 3;
    const correct = expectedFloorDiv(2, 3);
    expect(correct).toBeLessThan(naive);
    // Sum_{m>=1} P(X >= 3m) for Poisson(2) = 0.3233 + 0.0166 + ... = 0.340.
    expect(correct).toBeCloseTo(0.340, 2);
  });

  it('is exact where it can be checked by hand', () => {
    expect(poissonTail(1, 0)).toBe(1);
    expect(poissonTail(0, 1)).toBe(0);
    // P(X >= 1) for Poisson(1) is 1 - e^-1.
    expect(poissonTail(1, 1)).toBeCloseTo(1 - Math.exp(-1), 6);
  });

  it('over-pays high-rate players when a linear ramp replaces the tail — the v1 defect', () => {
    // v1: clamp01((expected / threshold) * 0.7). Compare it with the true tail at a rate sitting
    // just under the threshold, which is exactly where the premium defenders live.
    const threshold = 10;
    const rate = 9;
    const v1Ramp = Math.min(1, (rate / threshold) * 0.7);
    const tail = thresholdProbability(rate, threshold);
    expect(v1Ramp).toBeGreaterThan(tail);
  });

  it('widens the tail as dispersion rises, since defensive actions cluster', () => {
    const poisson = thresholdProbability(6, 10, 1);
    const clustered = thresholdProbability(6, 10, 1.5);
    expect(clustered).toBeGreaterThan(poisson);
  });
});

describe('team strength', () => {
  const rows = (...specs: [number, number, string, number][]): StrengthInputRow[] =>
    specs.map(([teamCode, opponentTeamCode, fixtureKey, expectedGoals]) => ({
      teamCode,
      opponentTeamCode,
      fixtureKey,
      expectedGoals,
    }));

  it("reads a team's xG against off its opponent's xG for, in the same fixture", () => {
    const league = buildLeague(rows([1, 2, 'f1', 2.0], [2, 1, 'f1', 0.5]));
    expect(league.teams.get(1)!.xgForPerMatch).toBeCloseTo(2.0);
    expect(league.teams.get(1)!.xgAgainstPerMatch).toBeCloseTo(0.5);
    expect(league.teams.get(2)!.xgAgainstPerMatch).toBeCloseTo(2.0);
  });

  it('skips a fixture with only one side rather than crediting a clean sheet nobody kept', () => {
    // One side cut away by the time filter is not the same as a team conceding nothing.
    const league = buildLeague(rows([1, 2, 'f1', 2.0]));
    expect(league.teams.get(1)!.xgAgainstPerMatch).toBe(0);
    expect(league.teams.get(1)!.matches).toBe(1);
  });

  it('falls back to the league average when a team has no history at all', () => {
    const league = buildLeague([]);
    const r = fixtureGoalRates(undefined, undefined, true, league, {
      homeAdvantage: 1.2,
      confidenceMatches: 4,
      leagueGoalsPerTeamMatch: 1.5,
    });
    // Cold start: league average, lifted by home advantage only.
    expect(r.lambdaFor).toBeCloseTo(1.5 * 1.2, 6);
    expect(r.lambdaAgainst).toBeCloseTo(1.5 / 1.2, 6);
  });

  it('derives P(clean sheet) from the same lambda that prices conceding', () => {
    expect(cleanSheetProbability(0)).toBe(1);
    expect(cleanSheetProbability(1.5)).toBeCloseTo(Math.exp(-1.5), 6);
  });
});

describe('the feature walk', () => {
  const row = (over: Partial<HistoryRow>): HistoryRow => ({
    season: '2024-25',
    round: 1,
    fixture: 1,
    playerCode: 100,
    webName: 'Test',
    position: 'MID',
    teamCode: 1,
    opponentTeamCode: 2,
    wasHome: true,
    minutes: 90,
    starts: 1,
    totalPoints: 5,
    goalsScored: 0,
    assists: 0,
    cleanSheets: 0,
    goalsConceded: 0,
    saves: 0,
    bonus: 0,
    bps: 20,
    defensiveContribution: null,
    expectedGoals: 0.3,
    expectedAssists: 0.2,
    value: 70,
    ...over,
  });

  it('cannot see the round it is predicting', () => {
    // The guarantee the whole backtest rests on. Round 1 is scored with an empty history; the
    // player's round-1 appearance only becomes visible at round 2.
    const rows = [row({ round: 1 }), row({ round: 2 })];
    // Materialised deliberately: features are computed at their own round and handed over as data,
    // so collecting the walk and reading it afterwards must give the SAME answer as reading it
    // inline. When these were a closure over the live accumulators, this returned [1, 1].
    const walked = [...walkRounds(rows, UNFITTED_PARAMS)];
    expect(walked.map((c) => c.items[0].features.matchesSample)).toEqual([0, 1]);
  });

  it('does not carry team strength across a season boundary', () => {
    // Promotion, relegation and squad turnover make last season's strength a claim about a different
    // team. Round 1 of the new season starts from the league average again.
    const rows = [
      row({ season: '2023-24', round: 38 }),
      row({ season: '2023-24', round: 38, teamCode: 2, opponentTeamCode: 1, wasHome: false }),
      row({ season: '2024-25', round: 1 }),
    ];
    const leagues = [...walkRounds(rows, UNFITTED_PARAMS)].map(
      (c) => c.league.teams.size,
    );
    expect(leagues[0]).toBe(0);
    expect(leagues[1]).toBe(0);
  });

  it('gives a player with no history the positional mean rather than an invented rate', () => {
    const [first] = [...walkRounds([row({})], UNFITTED_PARAMS)];
    const f = first.items[0].features;
    expect(f.matchesSample).toBe(0);
    expect(f.rates.xg90).toBeCloseTo(0.15, 2); // the MID shrinkage target
  });
});

describe('projectFixtureV2', () => {
  const minutes = minutesDistribution(1, 1, FITTED_PARAMS);
  const goals = { lambdaFor: 1.5, lambdaAgainst: 1.2, attackAdjustment: 1 };
  const rates = { xg90: 0.4, xa90: 0.2, defcon90: 6, saves90: 0, bps90: 25 };

  it('mixes appearance points instead of thresholding an expected minute count', () => {
    // A player who is 50/50 to see the hour must not be paid like a certainty either way.
    const coinflip = { ...minutes, pPlay: 1, pSixtyPlus: 0.5 };
    const p = projectFixtureV2('MID', coinflip, rates, goals, scoring, FITTED_PARAMS);
    expect(p.components.minutes).toBeCloseTo(0.5 * 2 + 0.5 * 1, 6);
  });

  it('never pays a defensive contribution to a goalkeeper', () => {
    const p = projectFixtureV2(
      'GKP',
      minutes,
      { ...rates, defcon90: 20 },
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(p.components.defensive_contribution).toBe(0);
  });

  it('pays a harder fixture fewer clean-sheet points', () => {
    const easy = projectFixtureV2('DEF', minutes, rates, { ...goals, lambdaAgainst: 0.7 }, scoring, FITTED_PARAMS);
    const hard = projectFixtureV2('DEF', minutes, rates, { ...goals, lambdaAgainst: 2.2 }, scoring, FITTED_PARAMS);
    expect(easy.components.clean_sheets).toBeGreaterThan(hard.components.clean_sheets);
    expect(hard.components.goals_conceded).toBeLessThan(easy.components.goals_conceded);
  });

  it('projects nothing at all for a player who cannot play', () => {
    const out = minutesDistribution(0.9, 0, FITTED_PARAMS);
    const p = projectFixtureV2('MID', out, rates, goals, scoring, FITTED_PARAMS);
    expect(p.ep).toBe(0);
  });

  it('keeps the fitted start curve away from a step function', () => {
    // The first fit returned a slope of 7.3e8 — separation — which turns every rotation risk into a
    // certainty. A flat-ish curve is the fitted answer and a near-vertical one is a bug.
    expect(Math.abs(FITTED_PARAMS.minutes.startSlope)).toBeLessThan(20);
    const nailed = minutesDistribution(0.95, 1, FITTED_PARAMS);
    const fringe = minutesDistribution(0.15, 1, FITTED_PARAMS);
    expect(nailed.pStart).toBeGreaterThan(fringe.pStart);
    expect(nailed.pStart).toBeLessThan(0.99);
    expect(fringe.pStart).toBeGreaterThan(0.01);
  });
});

describe('metrics', () => {
  it('reports bias with a sign, since direction is the whole diagnosis', () => {
    const over = errorStats([
      { predicted: 3, actual: 1, position: 'MID', value: 70, season: 's', round: 1 },
    ]);
    expect(over.bias).toBe(2);
  });

  it('buckets on fixed edges so two models can be compared row for row', () => {
    const curve = calibrationCurve([
      { predicted: 0.5, actual: 1, position: 'MID', value: 50, season: 's', round: 1 },
      { predicted: 5.5, actual: 4, position: 'MID', value: 50, season: 's', round: 1 },
    ]);
    expect(curve[0].n).toBe(1);
    expect(curve.find((b) => b.lower === 5)!.n).toBe(1);
  });
});
