import highsLoader from 'highs';
import { Rules } from '../rules';
import {
  buildLp,
  buildConflictPairs,
  pickBestXi,
  penalisedSquadEp,
  Candidate,
  Collisions,
  NO_COLLISIONS,
} from '../ilp';
import {
  OptimizerService,
  prunePool,
  arrangeSquad,
} from '../optimizer.service';
import { MIN_APPEARANCES } from '../policy';
import type { OptimizerRepository } from '../optimizer.repository';

/**
 * The two recommendation guards (B-010, B-011) and the checks that can go red.
 *
 * Each test names the sabotage that breaks it, because a guard test that would still pass with the
 * guard deleted is worth nothing (`fpl-testing-contract`). The sabotages are the plan's:
 * restrict the pair rule to FWD, set LAMBDA to 0, and move the appearance filter into
 * `buildUniverse`.
 */
const RULES_JSON = {
  squad_squadsize: 15,
  squad_squadplay: 11,
  squad_total_spend: 1000,
  squad_team_limit: 3,
};
const POSITIONS_JSON = [
  { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
  { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
  { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
  { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
];
const rules = new Rules(RULES_JSON, POSITIONS_JSON);

function mk(
  id: string,
  position: Candidate['position'],
  teamId: string,
  ep: number,
  extra: Partial<Candidate> = {},
): Candidate {
  return {
    key: `p_${id}`,
    playerId: id,
    webName: id,
    position,
    teamId,
    teamShortName: teamId.toUpperCase(),
    cost: 50,
    ep,
    pPlay: 0.9,
    appearances: 50,
    ...extra,
  };
}

describe('buildConflictPairs — both sides of one fixture (B-011)', () => {
  // Brighton host Chelsea. Palmer is a MID, which is the whole point of the FWD+MID rule: the
  // measured case was a MID captain against two of our own Brighton defenders.
  const bhaDef = mk('deCuyper', 'DEF', 'BHA', 5);
  const bhaGk = mk('verbruggen', 'GKP', 'BHA', 4);
  const bhaMid = mk('mitoma', 'MID', 'BHA', 5);
  const cheMid = mk('palmer', 'MID', 'CHE', 8);
  const cheFwd = mk('joaoPedro', 'FWD', 'CHE', 6);
  const cheDef = mk('cucurella', 'DEF', 'CHE', 5);
  const roster = [bhaDef, bhaGk, bhaMid, cheMid, cheFwd, cheDef];
  const fixture = [
    {
      homeTeamId: 'BHA',
      awayTeamId: 'CHE',
      homeTeamShortName: 'BHA',
      awayTeamShortName: 'CHE',
    },
  ];

  it('pairs every attacker against every opposing defender, in both directions', () => {
    const pairs = buildConflictPairs(roster, fixture);
    const shape = pairs
      .map((p) => `${p.attacker.playerId}>${p.defender.playerId}`)
      .sort();
    expect(shape).toEqual(
      [
        // Chelsea attack, Brighton defend
        'palmer>deCuyper',
        'palmer>verbruggen',
        'joaoPedro>deCuyper',
        'joaoPedro>verbruggen',
        // Brighton attack, Chelsea defend
        'mitoma>cucurella',
      ].sort(),
    );
  });

  it('includes the MID×DEF pair (sabotage: restrict the rule to FWD and this goes red)', () => {
    const pairs = buildConflictPairs(roster, fixture);
    expect(
      pairs.some(
        (p) =>
          p.attacker.position === 'MID' && p.defender.playerId === 'deCuyper',
      ),
    ).toBe(true);
  });

  it('never pairs two players of the same club, or players not in the fixture', () => {
    const other = mk('outsider', 'DEF', 'ARS', 5);
    const pairs = buildConflictPairs([...roster, other], fixture);
    expect(pairs.every((p) => p.attacker.teamId !== p.defender.teamId)).toBe(
      true,
    );
    expect(
      pairs.some(
        (p) => p.attacker.teamId === 'ARS' || p.defender.teamId === 'ARS',
      ),
    ).toBe(false);
  });

  it('a double gameweek contributes the pairs of both fixtures; a blank contributes none', () => {
    const single = buildConflictPairs(roster, fixture);
    const dgw = buildConflictPairs(roster, [
      ...fixture,
      {
        homeTeamId: 'CHE',
        awayTeamId: 'BHA',
        homeTeamShortName: 'CHE',
        awayTeamShortName: 'BHA',
      }, // the reverse tie, same gameweek
    ]);
    expect(dgw.length).toBe(single.length * 2);
    expect(buildConflictPairs(roster, [])).toEqual([]);
  });
});

describe('buildLp — the collision penalty is in the objective, not a post-hoc filter', () => {
  const squad = () => [
    mk('a1', 'MID', 'CHE', 8),
    mk('d1', 'DEF', 'BHA', 5),
    mk('d2', 'DEF', 'ARS', 5),
  ];
  const collisions = (lambda: number): Collisions => ({
    pairs: buildConflictPairs(squad(), [
      {
        homeTeamId: 'BHA',
        awayTeamId: 'CHE',
        homeTeamShortName: 'BHA',
        awayTeamShortName: 'CHE',
      },
    ]),
    lambda,
  });

  it('emits one z row per pair, on the SQUAD variables, at benchWeight x lambda', () => {
    const lp = buildLp(squad(), rules, collisions(1.5), 0.7);
    // On `x`, not on `y` (B-025). B-023 had put this row on the XI variables, and the solver
    // answered it by benching one side while still paying for both. Holding is the bet B-011's own
    // sentence describes, and holding is what `x` says.
    expect(lp).toMatch(/conf_0: p_a1 \+ p_d1 - z_0 <= 1/);
    expect(lp).not.toMatch(/conf_0: y_/);
    // 0.7 x 1.5. The charge scales with the coefficient it is charged against; see
    // `chargedCollisionLambda`.
    expect(lp).toMatch(/- 1\.0500 z_0/);
    // No row on the armband. A captain charge is one more thing a bench can dodge.
    expect(lp).not.toMatch(/capconf/);
    expect(lp).not.toMatch(/w_0/);
    // z is continuous — the -lambda objective pins it to its lower bound, so it must NOT be declared
    // binary. A z in the Binary section is a needless integer variable.
    expect(lp.slice(lp.indexOf('Binary'))).not.toMatch(/z_0/);
  });

  it('charges nothing when the bench weight is zero, and says so in the objective', () => {
    // The guard against the argument being forgotten: `buildLp` defaults `benchWeight` to the served
    // value precisely because a forgotten 0 here would switch the collision penalty off entirely
    // while every row still looked present.
    expect(buildLp(squad(), rules, collisions(1.5), 0)).toMatch(/[+-] 0\.0000 z_0/);
    expect(buildLp(squad(), rules, collisions(1.5))).toMatch(/- 1\.0500 z_0/);
  });

  it('emits no z row at LAMBDA = 0 (the sabotage: the collision tests below go red, these stay green)', () => {
    const lp = buildLp(squad(), rules, collisions(0));
    expect(lp).not.toMatch(/conf_/);
    expect(lp).toMatch(/budget:[\s\S]*<= 1000/);
    expect(lp).toMatch(/squad:[\s\S]*= 15/);
  });

  it('never names a player the LP does not contain (an implicit free variable with no meaning)', () => {
    // The pair set is built over the whole universe; only the two players in this LP may appear.
    const pool = [mk('a1', 'MID', 'CHE', 8)];
    const lp = buildLp(pool, rules, collisions(1));
    expect(lp).not.toMatch(/conf_/);
    expect(lp).not.toMatch(/p_d1/);
  });
});

describe('the solver acts on the penalty', () => {
  /** A universe with two interchangeable defenders: one collides with our best midfielder, one does
   * not, and the colliding one is worth `edge` more points. */
  function universe(edge: number): Candidate[] {
    const list: Candidate[] = [
      mk('gk1', 'GKP', 'T1', 4),
      mk('gk2', 'GKP', 'T2', 4),
      mk('star', 'MID', 'CHE', 20),
    ];
    for (let i = 0; i < 4; i++) list.push(mk(`d${i}`, 'DEF', `T${i + 3}`, 6));
    list.push(mk('dCollide', 'DEF', 'BHA', 6 + edge));
    list.push(mk('dClean', 'DEF', 'ARS', 6));
    for (let i = 0; i < 4; i++) list.push(mk(`m${i}`, 'MID', `T${i + 3}`, 6));
    for (let i = 0; i < 3; i++) list.push(mk(`f${i}`, 'FWD', `T${i + 3}`, 6));
    return list;
  }
  const fixtures = [
    {
      homeTeamId: 'BHA',
      awayTeamId: 'CHE',
      homeTeamShortName: 'BHA',
      awayTeamShortName: 'CHE',
    },
  ];
  const solveWith = async (edge: number, lambda: number) => {
    const cands = universe(edge);
    const collisions: Collisions = {
      pairs: buildConflictPairs(cands, fixtures),
      lambda,
    };
    const highs = await highsLoader();
    const sol = highs.solve(buildLp(cands, rules, collisions));
    expect(sol.Status).toBe('Optimal');
    return cands.filter(
      (c) => ((sol.Columns[c.key] as { Primal?: number })?.Primal ?? 0) > 0.5,
    );
  };

  it('drops the colliding defender when the pair costs more than it is worth', async () => {
    const chosen = await solveWith(0.5, 2);
    const ids = chosen.map((c) => c.playerId);
    expect(ids).toContain('star');
    expect(ids).toContain('dClean');
    expect(ids).not.toContain('dCollide');
  });

  it('still takes the pair when it is worth more than LAMBDA — a penalty, not an exclusion', async () => {
    const chosen = await solveWith(3, 1);
    const ids = chosen.map((c) => c.playerId);
    expect(ids).toContain('star');
    expect(ids).toContain('dCollide');
  });

  it('takes the colliding defender at LAMBDA = 0 (sabotage: the first case above goes red)', async () => {
    const chosen = await solveWith(0.5, 0);
    expect(chosen.map((c) => c.playerId)).toContain('dCollide');
  });
});

describe('the eleven is chosen on points, and the pair is charged anyway (B-025)', () => {
  /**
   * A fifteen whose three best defenders all face our captain's club. Before B-025 the penalty was
   * charged against the XI, so the solver answered it by starting the 4th-best defender and benching
   * the 3rd — paying for a player it would not field. `dCleanEp` tunes how much that swap would have
   * cost, and every test here asserts it no longer happens.
   */
  function squad(dCleanEp = 4): Candidate[] {
    return [
      mk('gk', 'GKP', 'T1', 4),
      mk('gkBench', 'GKP', 'T2', 3),
      mk('dA', 'DEF', 'BHA', 6),
      mk('dB', 'DEF', 'BHA', 6),
      mk('dC', 'DEF', 'BHA', 6),
      mk('dClean', 'DEF', 'ARS', dCleanEp),
      mk('dBench', 'DEF', 'T3', 1),
      mk('star', 'MID', 'CHE', 12),
      mk('m1', 'MID', 'T4', 7),
      mk('m2', 'MID', 'T5', 7),
      mk('m3', 'MID', 'T6', 7),
      mk('mSpare', 'MID', 'T7', 5),
      mk('f1', 'FWD', 'T8', 7),
      mk('f2', 'FWD', 'T9', 7),
      mk('f3', 'FWD', 'T10', 5),
    ];
  }
  const collisions = (lambda: number, dCleanEp = 4): Collisions => ({
    pairs: buildConflictPairs(squad(dCleanEp), [
      {
        homeTeamId: 'BHA',
        awayTeamId: 'CHE',
        homeTeamShortName: 'BHA',
        awayTeamShortName: 'CHE',
      },
    ]),
    lambda,
  });

  it('starts the better-projected defender however large the penalty', () => {
    // The old behaviour is the thing being asserted against: at lambda 2 this used to start dClean
    // over dC, and at lambda 3 it used to drop `star` from the eleven altogether. The charge is on
    // ownership now, so the fifteen is already paid for and the eleven is a pure points question.
    for (const lambda of [0, 1, 2, 3, 4]) {
      const xi = pickBestXi(squad(), rules);
      expect(xi.starters.has('p_dC')).toBe(true);
      expect(xi.starters.has('p_dClean')).toBe(false);
      expect(xi.starters.has('p_star')).toBe(true);
      expect(xi.captainKey).toBe('p_star');
      // The lambda is in the loop only to make the point that nothing here reads it: `pickBestXi`
      // no longer takes a collision context at all, which is the compile-time half of this test.
      expect(collisions(lambda).lambda).toBe(lambda);
    }
  });

  it('charges the pair the squad holds even when the eleven does not start both sides', () => {
    // The B-025 case in one assertion. `dBench` is a defender at 1 point who never starts; make him
    // the colliding one and the eleven contains only his opposite number, not him.
    const held = squad().map((c) =>
      c.playerId === 'dBench' ? mk('dBench', 'DEF', 'BHA', 1) : c,
    );
    const pairs = buildConflictPairs(held, [
      {
        homeTeamId: 'BHA',
        awayTeamId: 'CHE',
        homeTeamShortName: 'BHA',
        awayTeamShortName: 'CHE',
      },
    ]);
    const arranged = arrangeSquad(held, rules, { pairs, lambda: 1 });

    const benched = arranged.heldCollisions.filter(
      (h) => h.pair.defender.playerId === 'dBench',
    );
    expect(benched.length).toBeGreaterThan(0);
    expect(benched.every((h) => h.bothStarted)).toBe(false);
    // ...and it is still charged. Before B-025 this pair contributed nothing, and the payload said
    // `taken: []` about a squad holding both sides of it.
    expect(arranged.heldPenalty).toBeCloseTo(0.7 * pairs.length, 6);
  });

  it('charges the same whichever legal eleven is fielded — the charge is a fact about the fifteen', () => {
    // Two fifteens holding the SAME pairs, differing only in a projection that moves a colliding
    // defender in and out of the eleven. A charge that changed between them would be one the eleven
    // could still dodge.
    const starting = squad();
    const benchedInstead = squad().map((c) =>
      c.playerId === 'dC' ? mk('dC', 'DEF', 'BHA', 0.5) : c,
    );
    const pairsOf = (cands: Candidate[]) =>
      buildConflictPairs(cands, [
        {
          homeTeamId: 'BHA',
          awayTeamId: 'CHE',
          homeTeamShortName: 'BHA',
          awayTeamShortName: 'CHE',
        },
      ]);

    const a = arrangeSquad(starting, rules, {
      pairs: pairsOf(starting),
      lambda: 1,
    });
    const b = arrangeSquad(benchedInstead, rules, {
      pairs: pairsOf(benchedInstead),
      lambda: 1,
    });

    // The elevens really do differ — otherwise this test proves nothing.
    const startedIn = (arranged: typeof a, id: string) =>
      arranged.squad.find((p) => p.playerId === id)?.role !== 'bench';
    expect(startedIn(a, 'dC')).toBe(true);
    expect(startedIn(b, 'dC')).toBe(false);

    expect(b.heldPenalty).toBeCloseTo(a.heldPenalty, 6);
    expect(b.heldCollisions.length).toBe(a.heldCollisions.length);
  });

  it('reports nothing at lambda 0 — the sabotage the two tests above go red under', () => {
    const arranged = arrangeSquad(squad(), rules, collisions(0));
    expect(arranged.heldPenalty).toBe(0);
    // The pairs are still built; it is the price that is zero. A payload reporting an empty list
    // here is reporting "nothing was charged", not "no conflict exists".
    expect(collisions(0).pairs.length).toBeGreaterThan(0);
    expect(arranged.heldCollisions.length).toBeGreaterThan(0);
    expect(arranged.heldCollisions.every((h) => !h.bothStarted)).toBe(false);
  });

  it('returns a legal XI in every case: one keeper, eleven players, a legal split', () => {
    const xi = pickBestXi(squad(), rules);
    const starters = squad().filter((c) => xi.starters.has(c.key));
    expect(starters.length).toBe(11);
    expect(starters.filter((c) => c.position === 'GKP').length).toBe(1);
    expect(
      starters.filter((c) => c.position === 'DEF').length,
    ).toBeGreaterThanOrEqual(3);
    expect(xi.formation).toMatch(/^\d-\d-\d$/);
  });

  it('arrangeSquad benches the four it did not start, and names one captain', () => {
    const arranged = arrangeSquad(squad(), rules, collisions(2));
    expect(arranged.squad.filter((p) => p.role === 'bench').length).toBe(4);
    expect(arranged.squad.filter((p) => p.role === 'captain').length).toBe(1);
    expect(arranged.heldPenalty).toBeGreaterThan(0);
    expect(arranged.heldCollisions.length).toBeGreaterThan(0);
  });
});

describe('penalisedSquadEp — the quantity the ILP actually maximises', () => {
  const a = mk('a', 'MID', 'CHE', 10);
  const d = mk('d', 'DEF', 'BHA', 5);
  const pairs = buildConflictPairs(
    [a, d],
    [
      {
        homeTeamId: 'BHA',
        awayTeamId: 'CHE',
        homeTeamShortName: 'BHA',
        awayTeamShortName: 'CHE',
      },
    ],
  );

  it('charges benchWeight x lambda per held pair, and nothing when only one side is held', () => {
    // 15 raw, less 0.7 x 2 for the one pair. The scaling is the LP's, and this function exists to
    // price a user's squad the same way the solve priced the recommendation — a comparison at a
    // different rate would report its own arithmetic as a gap between two squads.
    expect(penalisedSquadEp([a, d], { pairs, lambda: 2 })).toBeCloseTo(13.6, 6);
    expect(penalisedSquadEp([a], { pairs, lambda: 2 })).toBeCloseTo(10, 6);
    expect(penalisedSquadEp([a, d], NO_COLLISIONS)).toBeCloseTo(15, 6);
    // At a bench weight of 1 a squad place is worth its full EP again, and the charge is the raw
    // constant — which is what B-011 measured.
    expect(penalisedSquadEp([a, d], { pairs, lambda: 2 }, 1)).toBeCloseTo(13, 6);
  });
});

describe('the appearance floor applies to the pool and nowhere else (B-010)', () => {
  function universe(): Candidate[] {
    const list: Candidate[] = [];
    // a full legal set of established players
    const shape: [Candidate['position'], number][] = [
      ['GKP', 4],
      ['DEF', 8],
      ['MID', 8],
      ['FWD', 5],
    ];
    let i = 0;
    for (const [pos, n] of shape)
      for (let k = 0; k < n; k++)
        list.push(mk(`old${i++}`, pos, `T${i % 12}`, 5, { cost: 45 }));
    // the one-appearance forward the optimizer would otherwise start
    list.push(mk('newSigning', 'FWD', 'T20', 40, { appearances: 1, cost: 45 }));
    return list;
  }

  it('prunePool drops the sub-threshold player however good the projection looks', () => {
    const pool = prunePool(universe());
    expect(pool.map((c) => c.playerId)).not.toContain('newSigning');
    expect(pool.every((c) => c.appearances >= MIN_APPEARANCES)).toBe(true);
  });

  it('prunePool with the floor lifted keeps him — the comparison solve that prices the floor', () => {
    const pool = prunePool(universe(), { floor: false });
    expect(pool.map((c) => c.playerId)).toContain('newSigning');
  });

  it('filters BEFORE the top-EP/cheapest cut, so cheap fodder slots go to eligible players', () => {
    // Twelve one-appearance forwards at the cheapest price would sweep the cheap slots if the cut
    // ran first. It must not: there are zero eligible forwards at the cheap end in the real data.
    const stuffed = [
      ...universe(),
      ...Array.from({ length: 12 }, (_, k) =>
        mk(`cheapNew${k}`, 'FWD', 'T21', 1, { appearances: 0, cost: 40 }),
      ),
    ];
    const pool = prunePool(stuffed);
    expect(pool.filter((c) => c.position === 'FWD').length).toBeGreaterThan(0);
    expect(pool.some((c) => c.playerId.startsWith('cheapNew'))).toBe(false);
  });

  it('buildUniverse keeps every player — a user squad holding a new signing must still score', async () => {
    // Sabotage: move the filter from prunePool into buildUniverse and this goes red, because the
    // new signing loses his candidate and `insights` would score him as a removed player at zero.
    const players = universe().map((c) => ({
      id: c.playerId,
      webName: c.webName,
      position: c.position,
      teamId: c.teamId,
      nowCost: c.cost,
    }));
    const repo = {
      loadRules: async () => rules,
      latestProjectionModelVersion: async () => 'test-model',
      horizonGameweeks: async () => [2],
      loadProjections: async () =>
        players.map((p) => ({
          playerId: p.id,
          gameweekId: 2,
          expectedPoints: 5,
          playProbability: 0.9,
        })),
      loadPlayers: async () => players,
      appearanceCounts: async () =>
        new Map(universe().map((c) => [c.playerId, c.appearances])),
      fixturesFor: async () => [
        {
          homeTeamId: 'T20',
          awayTeamId: 'T1',
          homeTeamShortName: 'T20',
          awayTeamShortName: 'T1',
        },
      ],
    } as unknown as OptimizerRepository;

    const universeBuilt = await new OptimizerService(repo).buildUniverse();
    expect(universeBuilt.candidates.map((c) => c.playerId)).toContain(
      'newSigning',
    );
    expect(
      universeBuilt.candidates.find((c) => c.playerId === 'newSigning')
        ?.appearances,
    ).toBe(1);
    // and the collision context comes back with it, built over the whole universe
    expect(universeBuilt.collisions.pairs.length).toBeGreaterThan(0);
  });
});

/**
 * B-018 — the payload a refusal is stated in.
 *
 * Plan 009 specified `collisions: [{ fixture, attacker, defender, lambda, taken }]` and what shipped
 * emitted two team **cuids** instead. That defect is invisible in every test that checks a count, and
 * only surfaces when somebody tries to render it — a cuid on screen looks like data. So the test is
 * a shape test on the emitted strings, not on the count.
 */
describe('the reasoning payload can actually be rendered (B-018)', () => {
  /** Prisma's cuid: `c` then 24 lowercase alphanumerics. The exact thing that must never be emitted. */
  const CUID = /^c[a-z0-9]{24}$/;

  const pairs = buildConflictPairs(
    [
      mk('striker', 'FWD', 'tChe', 6),
      mk('keeper', 'GKP', 'tBha', 4),
      mk('back', 'DEF', 'tBha', 4),
    ],
    [
      {
        homeTeamId: 'tChe',
        awayTeamId: 'tBha',
        homeTeamShortName: 'CHE',
        awayTeamShortName: 'BHA',
      },
    ],
  );

  it('labels a pair with the match, home side first', () => {
    expect(pairs.length).toBeGreaterThan(0);
    for (const p of pairs) expect(p.fixture).toBe('CHE vs BHA');
  });

  it('labels the pair the same way whichever side attacks', () => {
    // A pair is "our attacker against our defender in this match". The match does not change when
    // the roles do, and two labels for one fixture would read as two fixtures.
    const bothWays = buildConflictPairs(
      [
        mk('cheStriker', 'FWD', 'tChe', 6),
        mk('cheBack', 'DEF', 'tChe', 4),
        mk('bhaStriker', 'FWD', 'tBha', 6),
        mk('bhaBack', 'DEF', 'tBha', 4),
      ],
      [
        {
          homeTeamId: 'tChe',
          awayTeamId: 'tBha',
          homeTeamShortName: 'CHE',
          awayTeamShortName: 'BHA',
        },
      ],
    );
    expect(new Set(bothWays.map((p) => p.fixture))).toEqual(
      new Set(['CHE vs BHA']),
    );
  });

  it('emits no cuid anywhere in the rendered collision entry', () => {
    // The entry as `RecommendationReasoning` builds it — names and a label, no ids.
    const entries = pairs.map((p) => ({
      fixture: p.fixture,
      attacker: p.attacker.webName,
      defender: p.defender.webName,
      lambda: 0.7,
      bothStarted: true,
    }));
    for (const e of entries) {
      for (const value of Object.values(e)) {
        if (typeof value === 'string') expect(value).not.toMatch(CUID);
      }
    }
  });

  it('and the guard is not vacuous — a real cuid does match the shape it rejects', () => {
    // If this pattern matched nothing, the test above would pass for every payload forever.
    expect('cmt9x1wjf0006lp3t2s0z9qa2').toMatch(CUID);
  });
});
