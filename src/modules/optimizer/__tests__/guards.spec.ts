import highsLoader from 'highs';
import { Rules } from '../rules';
import {
  buildLp,
  defencePairs,
  pickBestXi,
  penalisedSquadEp,
  Candidate,
  Concentration,
  NO_CONCENTRATION,
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

describe('defencePairs — two of one club\'s defence (B-029)', () => {
  const squad = () => [
    mk('gk', 'GKP', 'BHA', 4),
    mk('d1', 'DEF', 'BHA', 5),
    mk('d2', 'DEF', 'BHA', 5),
    mk('d3', 'DEF', 'ARS', 5),
    mk('m1', 'MID', 'BHA', 8),
  ];

  it('pairs every defensive player of a club with every other, keeper included', () => {
    const pairs = defencePairs(squad());
    // GKP+d1, GKP+d2, d1+d2. The keeper counts: he shares the clean sheet exactly.
    expect(pairs).toHaveLength(3);
    expect(pairs.every((p) => p.club === 'BHA')).toBe(true);
  });

  it('never pairs across clubs, and never pairs an attacker', () => {
    for (const p of defencePairs(squad())) {
      expect(p.a.teamId).toBe(p.b.teamId);
      for (const side of [p.a, p.b]) {
        expect(['DEF', 'GKP']).toContain(side.position);
      }
    }
  });

  it('finds nothing in a squad with one defender per club (sabotage: the tests below go green)', () => {
    const spread = [
      mk('a', 'DEF', 'T1', 5),
      mk('b', 'DEF', 'T2', 5),
      mk('c', 'GKP', 'T3', 4),
    ];
    expect(defencePairs(spread)).toEqual([]);
  });
});

describe('buildLp — the concentration charge is on the XI, not on ownership', () => {
  const squad = () => [
    mk('d1', 'DEF', 'BHA', 5),
    mk('d2', 'DEF', 'BHA', 5),
    mk('m1', 'MID', 'CHE', 8),
  ];
  const concentration = (lambda: number): Concentration => ({
    pairs: defencePairs(squad()),
    lambda,
  });

  it('emits one d row per pair, on the XI variables, at the policy lambda', () => {
    const lp = buildLp(squad(), rules, concentration(1.5), 0.7);
    // On `y`, deliberately — and this is the assertion that separates B-029 from B-011. A benched
    // player carries no variance, so benching IS an answer to this charge; owning both sides of a
    // fixture was a bet you had already placed, which is why that one lived on `x`.
    expect(lp).toMatch(/conc_0: y_p_d1 \+ y_p_d2 - d_0 <= 1/);
    expect(lp).not.toMatch(/conc_0: p_d1/);
    expect(lp).toMatch(/- 1\.5000 d_0/);
    // Nothing survives of the retired rule.
    expect(lp).not.toMatch(/conf_/);
    expect(lp).not.toMatch(/capconf/);
    expect(lp).not.toMatch(/z_0/);
    expect(lp).not.toMatch(/w_0/);
    // d is continuous — the -lambda objective pins it to its lower bound.
    expect(lp.slice(lp.indexOf('Binary'))).not.toMatch(/d_0/);
  });

  it('emits no d row at lambda 0 (the sabotage: the charge tests below go red, these stay green)', () => {
    const lp = buildLp(squad(), rules, concentration(0));
    expect(lp).not.toMatch(/conc_/);
    expect(lp).toMatch(/budget:[\s\S]*<= 1000/);
    expect(lp).toMatch(/squad:[\s\S]*= 15/);
  });

  it('never names a player the LP does not contain (an implicit free variable with no meaning)', () => {
    const pool = [mk('d1', 'DEF', 'BHA', 5)];
    const lp = buildLp(pool, rules, concentration(1));
    expect(lp).not.toMatch(/conc_/);
    expect(lp).not.toMatch(/p_d2/);
  });
});

describe('the eleven pays for a concentrated defence, and benching answers it (B-029)', () => {
  /**
   * Five defenders, three of them Brighton's. The best XI on raw points would start all three; the
   * charge is what makes starting the third cost something.
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
  const concentration = (lambda: number, dCleanEp = 4): Concentration => ({
    pairs: defencePairs(squad(dCleanEp)),
    lambda,
  });

  it('starts a worse defender from another club once the pairs are priced', () => {
    // Unpenalised, the three Brighton defenders start and dClean does not.
    const clean = pickBestXi(squad(), rules, 0.7, NO_CONCENTRATION);
    expect(clean.starters.has('p_dC')).toBe(true);
    expect(clean.starters.has('p_dClean')).toBe(false);

    // Priced, starting all three costs 3 pairs; starting two costs 1. The swap buys that back.
    const charged = pickBestXi(squad(), rules, 0.7, concentration(3));
    expect(charged.starters.has('p_dClean')).toBe(true);
    expect(charged.starters.size).toBe(11);
  });

  it('charges the STARTED pairs only — benching one member is a real answer here', () => {
    // The contrast with B-011 in one assertion. `dBench` at 1 point never starts, so his two pairs
    // with the other Brighton defenders are held and cost nothing.
    const arranged = arrangeSquad(
      squad(),
      rules,
      { pairs: defencePairs(squad()), lambda: 1 },
    );
    const held = arranged.heldPairs;
    const started = held.filter((h) => h.bothStarted);
    expect(held.length).toBeGreaterThan(started.length);
    expect(arranged.concentrationPenalty).toBeCloseTo(started.length, 6);
  });

  it('reports the pairs it holds but did not start, so the money spent is still visible', () => {
    const withBenchedBrighton = squad().map((c) =>
      c.playerId === 'dBench' ? mk('dBench', 'DEF', 'BHA', 0.5) : c,
    );
    const arranged = arrangeSquad(withBenchedBrighton, rules, {
      pairs: defencePairs(withBenchedBrighton),
      lambda: 1,
    });
    const benchedPairs = arranged.heldPairs.filter((h) => !h.bothStarted);
    expect(benchedPairs.length).toBeGreaterThan(0);
    expect(
      benchedPairs.every(
        (h) => h.pair.a.teamId === 'BHA' && h.pair.b.teamId === 'BHA',
      ),
    ).toBe(true);
  });

  it('charges nothing at lambda 0 — the sabotage the two tests above go red under', () => {
    const arranged = arrangeSquad(squad(), rules, concentration(0));
    expect(arranged.concentrationPenalty).toBe(0);
    // The pairs are still built; it is the price that is zero.
    expect(concentration(0).pairs.length).toBeGreaterThan(0);
    expect(arranged.heldPairs.length).toBeGreaterThan(0);
  });

  it('returns a legal XI in every case: one keeper, eleven players, a legal split', () => {
    for (const lambda of [0, 1, 3, 6]) {
      const xi = pickBestXi(squad(), rules, 0.7, concentration(lambda));
      const starters = squad().filter((c) => xi.starters.has(c.key));
      expect(starters.length).toBe(11);
      expect(starters.filter((c) => c.position === 'GKP').length).toBe(1);
      expect(xi.formation).toMatch(/^\d-\d-\d$/);
    }
  });

  it('arrangeSquad benches the four it did not start, and names one captain', () => {
    const arranged = arrangeSquad(squad(), rules, concentration(1));
    expect(arranged.squad.filter((p) => p.role === 'bench').length).toBe(4);
    expect(arranged.squad.filter((p) => p.role === 'captain').length).toBe(1);
  });
});

describe('penalisedSquadEp — raw horizon EP, and it says so (B-029)', () => {
  const a = mk('a', 'MID', 'CHE', 10);
  const d = mk('d', 'DEF', 'BHA', 5);

  it('charges nothing, because the only penalty left is charged on the eleven', () => {
    // Not an oversight and not dead code: this is handed a fifteen with no eleven chosen, and there
    // is no honest way to price a starting decision that has not been made.
    expect(penalisedSquadEp([a, d])).toBeCloseTo(15, 6);
    expect(penalisedSquadEp([a])).toBeCloseTo(10, 6);
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
    const players = [
      ...universe(),
      // A second defender of a club that already has one, so the concentration context has something
      // to find. Without it this universe holds one defensive player per club and the assertion at
      // the foot of this test would pass on an empty list forever.
      mk('clubmate', 'DEF', 'T5', 5, { appearances: 40, cost: 45 }),
    ].map((c) => ({
      id: c.playerId,
      webName: c.webName,
      position: c.position,
      teamId: c.teamId,
      teamShortName: c.teamShortName,
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
        new Map(
          [...universe(), mk('clubmate', 'DEF', 'T5', 5, { appearances: 40 })].map(
            (c) => [c.playerId, c.appearances],
          ),
        ),
    } as unknown as OptimizerRepository;

    const universeBuilt = await new OptimizerService(repo).buildUniverse();
    expect(universeBuilt.candidates.map((c) => c.playerId)).toContain(
      'newSigning',
    );
    expect(
      universeBuilt.candidates.find((c) => c.playerId === 'newSigning')
        ?.appearances,
    ).toBe(1);
    // and the concentration context comes back with it, built over the whole universe — including
    // players the pool would prune, because `insights` scores squads the optimizer did not choose.
    expect(universeBuilt.concentration.pairs.length).toBeGreaterThan(0);
    expect(
      universeBuilt.concentration.pairs.every((p) => p.a.teamId === p.b.teamId),
    ).toBe(true);
  });
});

/**
 * B-018 — the payload a refusal is stated in.
 *
 * Plan 009 specified a collision entry and what shipped emitted two team **cuids** instead. That
 * defect is invisible in every test that checks a count, and only surfaces when somebody tries to
 * render it — a cuid on screen looks like data. The rule those entries described is retired (B-029),
 * and the shape test moved with it rather than being deleted: the concentration entry names a club
 * and two players, and a club id would break it in exactly the same way.
 */
describe('the reasoning payload can actually be rendered (B-018)', () => {
  /** Prisma's cuid: `c` then 24 lowercase alphanumerics. The exact thing that must never be emitted. */
  const CUID = /^c[a-z0-9]{24}$/;

  // Two of one club's defence, with the club carried as its SHORT NAME rather than its id.
  const pairs = defencePairs([
    mk('keeper', 'GKP', 'tBha', 4, { teamShortName: 'BHA' }),
    mk('back', 'DEF', 'tBha', 4, { teamShortName: 'BHA' }),
    mk('striker', 'FWD', 'tChe', 6, { teamShortName: 'CHE' }),
  ]);

  it('labels a pair with the club, by short name', () => {
    expect(pairs).toHaveLength(1);
    expect(pairs[0].club).toBe('BHA');
  });

  it('pairs only within a club, so a label is never ambiguous', () => {
    const twoClubs = defencePairs([
      mk('bhaKeeper', 'GKP', 'tBha', 4, { teamShortName: 'BHA' }),
      mk('bhaBack', 'DEF', 'tBha', 4, { teamShortName: 'BHA' }),
      mk('cheKeeper', 'GKP', 'tChe', 4, { teamShortName: 'CHE' }),
      mk('cheBack', 'DEF', 'tChe', 4, { teamShortName: 'CHE' }),
    ]);
    expect(new Set(twoClubs.map((p) => p.club))).toEqual(
      new Set(['BHA', 'CHE']),
    );
    for (const p of twoClubs) expect(p.a.teamId).toBe(p.b.teamId);
  });

  it('emits no cuid anywhere in the rendered concentration entry', () => {
    // The entry as `RecommendationReasoning` builds it — a club short name and two web names, no ids.
    const entries = pairs.map((p) => ({
      club: p.club,
      players: [p.a.webName, p.b.webName],
      lambda: 1,
    }));
    for (const e of entries) {
      expect(e.club).not.toMatch(CUID);
      for (const name of e.players) expect(name).not.toMatch(CUID);
    }
  });

  it('and the guard is not vacuous — a real cuid does match the shape it rejects', () => {
    // If this pattern matched nothing, the test above would pass for every payload forever.
    expect('cmt9x1wjf0006lp3t2s0z9qa2').toMatch(CUID);
  });
});
