import { minutesDistribution } from '../model-v2';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../fitted';
import { HistoryRow, walkRounds } from '../features';

/**
 * B-019 — the substitute-appearance term.
 *
 * The defect this replaces was not a wrong number, it was a wrong OBJECT: a single global constant
 * standing in for a per-player rate. So the tests here are about whether the term can now tell two
 * players apart, and about the two ways a per-player feature silently stops being one:
 *
 *  - it reads the round it is predicting (caught by walking a real sequence and checking the first
 *    round gets the prior and nothing else);
 *  - it is computed and then not actually used (caught by requiring two different inputs to produce
 *    two different outputs through `minutesDistribution`, which is the function the model calls).
 */

const lagged = (startRate: number, subRate: number) => ({ startRate, subRate });

describe('the substitute-appearance curve', () => {
  it('separates a super-sub from a fringe player, which one constant could not', () => {
    const superSub = minutesDistribution(lagged(0.05, 0.85), 1, FITTED_PARAMS);
    const fringe = minutesDistribution(lagged(0.05, 0.05), 1, FITTED_PARAMS);

    expect(superSub.pSub).toBeGreaterThan(fringe.pSub);
    // The whole point: the gap has to be large enough to change a decision, not merely non-zero.
    expect(superSub.pSub - fringe.pSub).toBeGreaterThan(0.3);
    // Both start rarely, so the difference has to come from the sub term and not from the start one.
    expect(superSub.pStart).toBeCloseTo(fringe.pStart, 10);
  });

  it('is monotone in the lagged sub rate', () => {
    const rates = [0.05, 0.2, 0.4, 0.6, 0.8, 0.95];
    const out = rates.map(
      (r) => minutesDistribution(lagged(0.1, r), 1, FITTED_PARAMS).pSub,
    );
    for (let i = 1; i < out.length; i++) {
      expect(out[i]).toBeGreaterThan(out[i - 1]);
    }
  });

  it('the sub term is bounded by the probability of not starting', () => {
    // pSub is conditioned on NOT starting, so however high the lagged sub rate goes it can never add
    // more than `1 − pStart` — otherwise pPlay exceeds 1 and every bench order built on it is wrong.
    //
    // Note what the fitted numbers actually say here, because it reads as a bug and is not: a player
    // with a lagged start rate of 0.99 gets pStart 0.885, because `startSlope` is 0.485 and the curve
    // is deliberately flat. The remaining 11.5% is a start he did not get, and a player who always
    // comes on when he does not start takes essentially all of it. pPlay lands at 1.0, correctly.
    const nailed = minutesDistribution(lagged(0.99, 0.99), 1, FITTED_PARAMS);
    expect(nailed.pSub).toBeLessThanOrEqual(1 - nailed.pStart + 1e-12);
    expect(nailed.pPlay).toBeLessThanOrEqual(1);
    expect(nailed.pPlay).toBeCloseTo(1, 2);

    // And the same player with no history of coming on keeps the start probability and loses the rest.
    const neverComesOn = minutesDistribution(
      lagged(0.99, 0.02),
      1,
      FITTED_PARAMS,
    );
    expect(neverComesOn.pStart).toBeCloseTo(nailed.pStart, 10);
    expect(neverComesOn.pPlay).toBeLessThan(nailed.pPlay);
  });

  it('an unavailable player gets nothing from either term', () => {
    const out = minutesDistribution(lagged(0.9, 0.9), 0, FITTED_PARAMS);
    expect(out.pStart).toBe(0);
    expect(out.pSub).toBe(0);
    expect(out.pPlay).toBe(0);
  });

  /**
   * The unfitted baseline must still behave exactly as v1 did, because it is the thing the fitted
   * parameters are compared against. `subSlope: 0` is what makes the curve flat at the old constant;
   * if that stopped being true, every "the fit beat the guesses" number would be measured against a
   * different baseline than the one it claims.
   */
  it('the unfitted parameters reduce to v1 — one flat constant', () => {
    const a = minutesDistribution(lagged(0.1, 0.05), 1, UNFITTED_PARAMS);
    const b = minutesDistribution(lagged(0.1, 0.95), 1, UNFITTED_PARAMS);
    expect(a.pSub).toBeCloseTo(b.pSub, 10);
    // (1 − pStart) × 0.35, the v1 expression.
    expect(a.pSub).toBeCloseTo((1 - a.pStart) * 0.35, 6);
  });
});

const row = (over: Partial<HistoryRow>): HistoryRow => ({
  season: '2025-26',
  round: 1,
  fixture: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 0,
  starts: 0,
  totalPoints: 0,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  saves: 0,
  bonus: 0,
  bps: 0,
  defensiveContribution: null,
  expectedGoals: 0,
  expectedAssists: 0,
  expectedGoalsConceded: 0,
  ictIndex: 0,
  value: 50,
  ...over,
});

describe('laggedSubRate, as the feature walk produces it', () => {
  it('is the prior for a player with no history at all', () => {
    const [first] = [...walkRounds([row({})], UNFITTED_PARAMS)];
    // SUB_RATE_PRIOR — a player nobody has seen is a squad player, not a certainty either way.
    expect(first.items[0].features.laggedSubRate).toBeCloseTo(0.15, 6);
  });

  /**
   * THE LEAK TEST. The rate at round N must be built from rounds before N only. A player who comes
   * on in round 1 must still read as the prior AT round 1 — if the walk folded the round in first,
   * this would already be 1.0 and no output anywhere would look wrong.
   */
  it('does not read the round it is predicting', () => {
    const rows = [
      row({ round: 1, minutes: 20 }),
      row({ round: 2, minutes: 20 }),
      row({ round: 3, minutes: 20 }),
    ];
    const contexts = [...walkRounds(rows, UNFITTED_PARAMS)];
    expect(contexts[0].items[0].features.laggedSubRate).toBeCloseTo(0.15, 6);
    // By round 3 two non-start appearances are folded in and the rate has moved off the prior.
    expect(contexts[2].items[0].features.laggedSubRate).toBeGreaterThan(0.15);
  });

  it('rises for a player who keeps coming on and falls for one who never does', () => {
    const comesOn = Array.from({ length: 12 }, (_, i) =>
      row({ round: i + 1, minutes: 15 }),
    );
    const neverUsed = Array.from({ length: 12 }, (_, i) =>
      row({ round: i + 1, minutes: 0 }),
    );

    const last = (rows: HistoryRow[]) => {
      const contexts = [...walkRounds(rows, UNFITTED_PARAMS)];
      return contexts[contexts.length - 1].items[0].features.laggedSubRate;
    };

    expect(last(comesOn)).toBeGreaterThan(0.5);
    expect(last(neverUsed)).toBeLessThan(0.1);
  });

  it('a player who has started every match falls back to the prior rather than to zero', () => {
    // He has no non-start record at all. Reading that as "never comes on" would bench him the moment
    // he loses his place, which is the exact opposite of what the record supports.
    const alwaysStarted = Array.from({ length: 10 }, (_, i) =>
      row({ round: i + 1, minutes: 90, starts: 1 }),
    );
    const contexts = [...walkRounds(alwaysStarted, UNFITTED_PARAMS)];
    const f = contexts[contexts.length - 1].items[0].features;
    expect(f.laggedSubRate).toBeCloseTo(0.15, 6);
    expect(f.laggedStartRate).toBeCloseTo(1, 6);
  });
});
