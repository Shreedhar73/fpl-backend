import highsLoader from 'highs';
import { Rules } from '../../optimizer/rules';
import { LpSolution } from '../../optimizer/ilp';
import { PredictionRow } from '../harness';
import { predictionRow } from './prediction-row';
import { replaySeason, ReplayOptions } from '../xi-replay';

/**
 * B-025 — the replay harness.
 *
 * **The one thing this file exists to prevent.** Every other season harness in the repo re-chooses
 * the lineup by predicted points, which is why none of them could see what the objective did to the
 * XI. A replay harness that quietly did the same would produce a season total that looks entirely
 * healthy and answers a different question — the exact shape `oe:checks-that-cannot-fail` calls a
 * check that cannot go red. So the central test drives the harness with a solver whose XI is
 * DELIBERATELY not the EP-optimal one, and asserts the score is the solver's.
 */

const RULES = new Rules(
  {
    squad_squadsize: 15,
    squad_squadplay: 11,
    squad_total_spend: 1000,
    squad_team_limit: 3,
  },
  [
    { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
    { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
    { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
    { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
  ],
);

const OPTIONS: ReplayOptions = {
  label: 'test',
  benchWeight: 0.7,
  concentrationLambda: 1,
};

const row = (over: Partial<PredictionRow>): PredictionRow =>
  predictionRow({
    actual: 2,
    minutes: 90,
    predicted: { model: 2, form: 2, priorSeason: 2, v4: null },
    appearances: 20,
    value: 50,
    ...over,
  });

/**
 * A legal fifteen: 2 GKP, 5 DEF, 5 MID, 3 FWD over five clubs, so the 3-per-club cap holds and the
 * squad is one a real solve would accept.
 */
function fifteen(
  round: number,
  over: (i: number, position: string) => Partial<PredictionRow> = () => ({}),
): PredictionRow[] {
  const spec: [string, number][] = [
    ['GKP', 2],
    ['DEF', 5],
    ['MID', 5],
    ['FWD', 3],
  ];
  const out: PredictionRow[] = [];
  let i = 0;
  for (const [position, n] of spec) {
    for (let k = 0; k < n; k++) {
      out.push(
        row({
          round,
          playerCode: i + 1,
          webName: `${position}-${k}`,
          position,
          teamCode: Math.floor(i / 3) + 1,
          opponentTeamCode: 90 + Math.floor(i / 3),
          wasHome: true,
          ...over(i, position),
        }),
      );
      i++;
    }
  }
  return out;
}

const byCodeOf = (rows: PredictionRow[]) =>
  new Map(rows.map((r) => [r.playerCode, r]));

/** A solve, hand-built: everyone owned, these eleven started, this one captained. */
function solutionOf(
  owned: PredictionRow[],
  started: PredictionRow[],
  captain: PredictionRow,
  over: Partial<LpSolution> = {},
): LpSolution {
  const Columns: LpSolution['Columns'] = {};
  let index = 0;
  const set = (name: string) => {
    Columns[name] = { Index: index++, Primal: 1 };
  };
  for (const p of owned) set(`p_${p.playerCode}`);
  for (const p of started) set(`y_p_${p.playerCode}`);
  set(`k_p_${captain.playerCode}`);
  return { Status: 'Optimal', ObjectiveValue: 0, Columns, ...over };
}

describe('the replay harness scores the solver’s XI', () => {
  /**
   * Two defenders differ in both projection and outcome, in opposite directions. A harness that
   * re-chose the lineup by projection would start the 9-point-projected one and score 30; the solver
   * starts the 1-point-projected one, and the harness must report 20.
   */
  const squad = fifteen(1, (i, position) => {
    if (position !== 'DEF') return {};
    if (i === 2) return { predicted: { model: 9, form: 9, priorSeason: 9, v4: null }, actual: 10 };
    if (i === 3) return { predicted: { model: 1, form: 1, priorSeason: 1, v4: null }, actual: 0 };
    return {};
  });
  const byCode = byCodeOf(squad);
  const high = squad[2];
  const low = squad[3];

  // The eleven: one keeper, three defenders (deliberately including `low` and excluding `high`),
  // five midfielders, two forwards.
  const started = [
    squad[0],
    squad[3],
    squad[4],
    squad[5],
    squad[7],
    squad[8],
    squad[9],
    squad[10],
    squad[11],
    squad[12],
    squad[13],
  ];

  const replay = () =>
    replaySeason(
      '2025-26',
      new Map([[1, byCode]]),
      squad,
      'model',
      RULES,
      () => solutionOf(squad, started, squad[12]),
      OPTIONS,
    );

  it('fields the eleven the solver chose, not the eleven the projections prefer', () => {
    const result = replay();
    const scored = result.rounds[0];

    // 10 starters at 2 points, `low` at 0, and the captain (a midfielder on 2) doubled.
    expect(scored.points).toBe(22);
    // The tell that this is not a re-derivation: `high` outscored `low` by 10 and is not in it.
    expect(scored.points).toBeLessThan(32);
    expect(scored.formation).toBe('3-5-2');
  });

  it('names the projection it gave up, so a benched starter cannot pass unnoticed', () => {
    const scored = replay().rounds[0];
    // 15 points: 8 in the eleven (a 9-projection defender sat for a 1-projection one) and 7 more in
    // the armband, which the best XI would have put on the defender it started rather than on a
    // forward projected 2. `swaps` itemises the first half.
    expect(scored.epForgone).toBeCloseTo(15, 6);
    expect(scored.forgone).toEqual([
      expect.objectContaining({
        position: 'DEF',
        benched: high.webName,
        benchedEp: 9,
        started: low.webName,
        startedEp: 1,
      }),
    ]);
    expect(replay().roundsForgoingEp).toBe(1);
  });

  it('reports no forgone points when the solver did take the best XI', () => {
    // The armband moves with the XI: the best eleven captained by anyone but its best projection is
    // still points forgone, and the harness counts the captain's double the way the objective does.
    const withHigh = started.map((p) => (p.playerCode === low.playerCode ? high : p));
    const result = replaySeason(
      '2025-26',
      new Map([[1, byCode]]),
      squad,
      'model',
      RULES,
      () => solutionOf(squad, withHigh, high),
      OPTIONS,
    );
    expect(result.rounds[0].epForgone).toBeCloseTo(0, 6);
    expect(result.rounds[0].forgone).toEqual([]);
    expect(result.roundsForgoingEp).toBe(0);
  });
});

describe('an unreadable solve stops the replay', () => {
  const squad = fifteen(1);
  const byCode = byCodeOf(squad);
  // 1 GKP, 3 DEF, 5 MID, 2 FWD — legal, and leaving the reserve keeper (index 1) on the bench so
  // the armband test has a squad member who is demonstrably not starting.
  const eleven = [
    squad[0],
    squad[2],
    squad[3],
    squad[4],
    squad[7],
    squad[8],
    squad[9],
    squad[10],
    squad[11],
    squad[12],
    squad[13],
  ];

  const run = (solve: () => LpSolution) =>
    replaySeason('2025-26', new Map([[1, byCode]]), squad, 'model', RULES, solve, OPTIONS);

  it('throws rather than falling back to the enumeration when the solver fails', () => {
    expect(() =>
      run(() => solutionOf(squad, eleven, squad[3], { Status: 'Infeasible' })),
    ).toThrow(/Infeasible/);
  });

  it('throws on a short XI', () => {
    expect(() => run(() => solutionOf(squad, eleven.slice(0, 10), squad[3]))).toThrow(
      /XI of 10/,
    );
  });

  it('throws when the armband is on a player who is not starting', () => {
    expect(() => run(() => solutionOf(squad, eleven, squad[1]))).toThrow(/captained/);
  });
});

describe('the concentration is counted from the squad itself (B-029)', () => {
  /**
   * Three of our defenders play for club 1, and the fifteen starts all three. That is three pairs
   * held and three started — the shape the charge exists for. No fixture lookup is involved: two of a
   * club's defence are concentrated in every week they both play, which is why B-029's context is
   * built from the squad and B-011's had to be built per fixture.
   */
  const squad = fifteen(1, (i) => {
    if (i >= 2 && i <= 4) return { teamCode: 1 };
    // The keepers go to two DIFFERENT clubs. Left on one they would be a same-club defensive pair
    // themselves — correctly, since two keepers of a club share the same clean sheet — and this test
    // is about the three defenders.
    if (i === 0) return { teamCode: 7 };
    if (i === 1) return { teamCode: 8 };
    return {};
  });
  const byCode = byCodeOf(squad);

  const startedEleven = [
    squad[0],
    squad[2],
    squad[3],
    squad[4],
    squad[7],
    squad[8],
    squad[9],
    squad[10],
    squad[11],
    squad[12],
    squad[13],
  ];

  it('counts pairs the squad holds, and separately the ones it started', () => {
    const result = replaySeason(
      '2025-26',
      new Map([[1, byCode]]),
      squad,
      'model',
      RULES,
      () => solutionOf(squad, startedEleven, squad[9]),
      OPTIONS,
    );
    const scored = result.rounds[0];
    // Three defenders of one club: three pairs, and all three start.
    expect(scored.heldPairs).toBe(3);
    expect(scored.startedPairs).toBe(3);
    expect(result.roundsOwningAPair).toBe(1);
    expect(result.roundsStartingAPair).toBe(1);
  });

  it('drops the started count when one of them is benched, and keeps the held count', () => {
    // The distinction the whole rule turns on. Benching one of the three leaves three pairs held and
    // only one started — a squad still paying for a defence it does not field.
    const withOneBenched = startedEleven.map((p) =>
      p.playerCode === squad[4].playerCode ? squad[5] : p,
    );
    const result = replaySeason(
      '2025-26',
      new Map([[1, byCode]]),
      squad,
      'model',
      RULES,
      () => solutionOf(squad, withOneBenched, squad[9]),
      OPTIONS,
    );
    expect(result.rounds[0].heldPairs).toBe(3);
    expect(result.rounds[0].startedPairs).toBe(1);
  });
});

describe('against the real solver', () => {
  /**
   * The fake solver above cannot tell us whether `buildLp` over an already-owned fifteen is even
   * feasible — and it has a budget row, a club cap and position quotas that a held squad has to keep
   * satisfying in round 38. Pricing the squad at purchase cost is what makes that true; this is the
   * test that would fail if it were ever priced at market instead.
   */
  it('solves a held fifteen every round and returns a legal, captained XI', async () => {
    const highs = await highsLoader();
    const squad = fifteen(1);
    const rounds = new Map([
      [1, byCodeOf(squad)],
      [2, byCodeOf(fifteen(2))],
    ]);
    const result = replaySeason(
      '2025-26',
      rounds,
      squad,
      'model',
      RULES,
      (lp) => highs.solve(lp),
      OPTIONS,
    );
    expect(result.rounds).toHaveLength(2);
    for (const scored of result.rounds) {
      // 11 starters at 2 points plus a doubled captain.
      expect(scored.points).toBe(24);
      expect(scored.epForgone).toBeCloseTo(0, 6);
    }
  });
});
