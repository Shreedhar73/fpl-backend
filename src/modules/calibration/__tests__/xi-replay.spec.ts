import highsLoader from 'highs';
import { Rules } from '../../optimizer/rules';
import { LpSolution } from '../../optimizer/ilp';
import { PredictionRow } from '../harness';
import { predictionRow } from './prediction-row';
import { fixturesForRound, replaySeason, ReplayOptions } from '../xi-replay';

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
  collisionLambda: 1,
};

const row = (over: Partial<PredictionRow>): PredictionRow =>
  predictionRow({
    actual: 2,
    minutes: 90,
    predicted: { model: 2, form: 2, priorSeason: 2 },
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
    if (i === 2) return { predicted: { model: 9, form: 9, priorSeason: 9 }, actual: 10 };
    if (i === 3) return { predicted: { model: 1, form: 1, priorSeason: 1 }, actual: 0 };
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

describe('collisions are priced from the round’s own fixtures', () => {
  /**
   * Club 1 (the keeper and two defenders) away at club 4 (two midfielders and a forward): our
   * defenders and our attackers are on opposite sides of one match, which is precisely B-011's case.
   */
  const squad = fifteen(1, (i) => {
    if (i >= 9 && i <= 11) return { teamCode: 4, opponentTeamCode: 1, wasHome: true };
    if (i >= 2 && i <= 4) return { teamCode: 1, opponentTeamCode: 4, wasHome: false };
    // The keepers move off club 1 so it holds exactly the three defenders — a club cap of 3 is a
    // rule the fake solver cannot enforce, and a fixture built on an illegal squad proves nothing.
    if (i <= 1) return { teamCode: 7, opponentTeamCode: 91, wasHome: true };
    return {};
  });
  const byCode = byCodeOf(squad);

  it('recovers each fixture once from the rows that played in it', () => {
    const fixtures = fixturesForRound(byCode);
    const meeting = fixtures.filter(
      (f) => f.homeTeamId === '4' && f.awayTeamId === '1',
    );
    expect(meeting).toHaveLength(1);
    // The away side contributes no second copy of the same match.
    expect(fixtures.some((f) => f.homeTeamId === '1' && f.awayTeamId === '4')).toBe(
      false,
    );
  });

  it('counts pairs the squad owns, and separately the ones it started', () => {
    const started = [
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
    const result = replaySeason(
      '2025-26',
      new Map([[1, byCode]]),
      squad,
      'model',
      RULES,
      () => solutionOf(squad, started, squad[9]),
      OPTIONS,
    );
    const scored = result.rounds[0];
    // Three of ours defend for club 1; three attack for club 4, and the two clubs meet.
    expect(scored.ownedPairs).toBe(9);
    // All six start, so every owned pair is also a started one.
    expect(scored.startedPairs).toBe(9);
    // The captain is one of the attackers, so his exposure is his three defensive counterparts.
    expect(scored.captainConflicts).toBe(3);
    expect(result.roundsOwningAPair).toBe(1);
    expect(result.roundsStartingAPair).toBe(1);
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
