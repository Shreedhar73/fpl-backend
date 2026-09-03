import type { Candidate } from '../../optimizer/ilp';
import { NO_CONCENTRATION } from '../../optimizer/ilp';
import { arrangeSquad, type Universe } from '../../optimizer/optimizer.service';
import { Rules } from '../../optimizer/rules';
import { InsightsService } from '../insights.service';
import type { SquadDto } from '../../squad/dto/squad.dto';

/**
 * The advice's guarantees, asserted against a synthetic universe so they hold for reasons the test
 * controls rather than for reasons the live data happens to have.
 *
 * The one that matters most: the gap against the optimal 15 is never negative. It is negative only
 * if the two sides were measured against different numbers, which is a bug that would otherwise
 * show up as a plausible-looking payload.
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

/** The legal 2/5/5/3 shape, written out rather than generated so it is checkable by eye. */
const SHAPE: Candidate['position'][] = [
  'GKP',
  'GKP',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'DEF',
  'MID',
  'MID',
  'MID',
  'MID',
  'MID',
  'FWD',
  'FWD',
  'FWD',
];

/** 15 players, `epOf(i)` expected points each, in the legal 2/5/5/3 shape. */
function squad(prefix: string, epOf: (i: number) => number): Candidate[] {
  return SHAPE.map((position, i) => ({
    key: `p_${prefix}${i}`,
    playerId: `${prefix}${i}`,
    webName: `${prefix}${i}`,
    position,
    teamId: `t${i % 8}`,
    teamShortName: `T${i % 8}`,
    cost: 50,
    ep: epOf(i),
    pPlay: 1,
    appearances: 50,
  }));
}

function universeOf(...groups: Candidate[][]): Universe {
  return {
    candidates: groups.flat(),
    rules: RULES,
    gameweekIds: [2, 3, 4, 5, 6],
    modelVersion: 'test-model',
    concentration: NO_CONCENTRATION,
  };
}

function squadDto(picks: Candidate[], managerId: number | null): SquadDto {
  return {
    managerId,
    managerName: null,
    gameweekId: 2,
    bank: 0,
    teamValue: 750,
    activeChip: null,
    source: managerId === null ? 'recommended' : 'import',
    picks: picks.map((c, i) => ({
      playerId: c.playerId,
      fplId: 1000 + i,
      webName: c.webName,
      position: c.position,
      teamShortName: 'TST',
      nowCost: c.cost,
      sellValue: null,
      slot: i + 1,
      multiplier: 1,
      isCaptain: false,
      isViceCaptain: false,
    })),
  };
}

/**
 * Wire the service with fakes for everything it reaches through. The optimizer's *arrangement* is
 * the real one — that is the behaviour under test — while the solve is stubbed to a squad the test
 * chose, so "optimal" means what the test says it means.
 */
function build(mine: Candidate[], optimal: Candidate[], dto?: SquadDto) {
  const universe = universeOf(mine, optimal);
  const arrangedOptimal = arrangeSquad(optimal, RULES);

  const optimizer = {
    buildUniverse: jest.fn().mockResolvedValue(universe),
    run: jest.fn().mockResolvedValue({
      gameweekIds: universe.gameweekIds,
      singleGw: false,
      objectiveValue: 0,
      totalCost: 750,
      formation: arrangedOptimal.formation,
      squad: arrangedOptimal.squad,
      runId: null,
      durationMs: 1,
    }),
    loadRules: jest.fn().mockResolvedValue(RULES),
  };
  const squads = {
    getSquad: jest.fn().mockResolvedValue(dto ?? squadDto(mine, 42)),
    getRecommendedSquad: jest.fn().mockResolvedValue(squadDto(optimal, null)),
  };
  const repo = {
    projectionsFor: jest.fn().mockResolvedValue(
      new Map(
        universe.candidates.map((c) => [
          c.playerId,
          {
            playerId: c.playerId,
            // Next-gameweek EP is a fifth of the horizon here — an arbitrary but consistent
            // relationship, so the two comparisons cannot accidentally agree by being equal.
            expectedPoints: c.ep / 5,
            expectedMinutes: 80,
            playProbability: 0.9,
            components: { appearance: 2, goals: c.ep / 10 },
          },
        ]),
      ),
    ),
    playerMeta: jest.fn().mockResolvedValue(
      new Map(
        universe.candidates.map((c, i) => [
          c.playerId,
          {
            playerId: c.playerId,
            fplId: 1000 + i,
            teamShortName: 'TST',
            status: 'a',
            news: null,
            chanceOfPlayingNextRound: null,
          },
        ]),
      ),
    ),
  };

  return {
    service: new InsightsService(
      optimizer as never,
      squads as never,
      repo as never,
    ),
    optimizer,
  };
}

describe('InsightsService — the comparison', () => {
  it('reports a non-negative gap when the squad is worse than the optimum', async () => {
    const { service } = build(
      squad('mine', () => 5),
      squad('opt', () => 9),
    );
    const advice = await service.adviseManager(42);

    expect(advice.comparison.squadHorizonEp).toBe(75);
    expect(advice.comparison.optimalHorizonEp).toBe(135);
    expect(advice.comparison.horizonGap).toBe(60);
    expect(advice.comparison.horizonGap).toBeGreaterThanOrEqual(0);
  });

  it('reports exactly zero for a squad measured against itself', async () => {
    const same = squad('same', (i) => 3 + i);
    const { service } = build(same, same, squadDto(same, null));
    const advice = await service.adviseManager(42);

    expect(advice.comparison.horizonGap).toBe(0);
    expect(advice.comparison.xiNextGwGap).toBe(0);
    expect(advice.comparison.optimalHasThatYouDoNot).toHaveLength(0);
    expect(advice.comparison.youHaveThatOptimalDoesNot).toHaveLength(0);
  });

  it('names the players that differ, in both directions', async () => {
    const mine = squad('mine', () => 5);
    const optimal = squad('opt', () => 9);
    const { service } = build(mine, optimal);
    const advice = await service.adviseManager(42);

    expect(advice.comparison.optimalHasThatYouDoNot).toHaveLength(15);
    expect(advice.comparison.youHaveThatOptimalDoesNot).toHaveLength(15);
    expect(
      advice.comparison.optimalHasThatYouDoNot.every(
        (p) => p.teamShortName === 'TST',
      ),
    ).toBe(true);
  });

  it('does not solve a persisted run — the advice endpoint must not fill optimizer_runs', async () => {
    const { service, optimizer } = build(
      squad('mine', () => 5),
      squad('opt', () => 9),
    );
    await service.adviseManager(42);
    // `persist: false` is the part that matters — a persisted run here would bury the solves a
    // human asked for. `explain: true` is B-018's second solve, which is unpersisted too.
    expect(optimizer.run).toHaveBeenCalledWith({
      persist: false,
      explain: true,
    });
  });
});

describe('InsightsService — captain and bench', () => {
  it('captains the highest-EP starter and vices the next', async () => {
    // Ascending EP by index, so the last player of each position group is the best.
    const mine = squad('mine', (i) => i + 1);
    const { service } = build(
      mine,
      squad('opt', () => 100),
    );
    const advice = await service.adviseManager(42);

    const starters = advice.players
      .filter((p) => p.role !== 'bench')
      .sort((a, b) => b.epHorizon - a.epHorizon);

    expect(advice.captain).not.toBeNull();
    expect(advice.captain!.playerId).toBe(starters[0].playerId);
    expect(advice.viceCaptain!.playerId).toBe(starters[1].playerId);
  });

  it('disagrees with a squad whose stored captain is the worst player in it', async () => {
    const mine = squad('mine', (i) => i + 1);
    const dto = squadDto(mine, 42);
    // Break it on purpose: crown the lowest-EP player. The advice must not follow.
    const worst = [...dto.picks].sort(
      (a, b) =>
        mine.find((c) => c.playerId === a.playerId)!.ep -
        mine.find((c) => c.playerId === b.playerId)!.ep,
    )[0];
    worst.isCaptain = true;
    worst.multiplier = 2;

    const { service } = build(
      mine,
      squad('opt', () => 100),
      dto,
    );
    const advice = await service.adviseManager(42);

    expect(advice.captain!.playerId).not.toBe(worst.playerId);
    // And the player who is wrongly captained is not even reported as one.
    const asAdvised = advice.players.find((p) => p.playerId === worst.playerId);
    expect(asAdvised!.role).not.toBe('captain');
  });

  it('puts the reserve keeper in bench slot 1 and the outfielders in descending order', async () => {
    const mine = squad('mine', (i) => i + 1);
    const { service } = build(
      mine,
      squad('opt', () => 100),
    );
    const advice = await service.adviseManager(42);

    const bench = advice.players
      .filter((p) => p.role === 'bench')
      .sort((a, b) => (a.benchOrder ?? 0) - (b.benchOrder ?? 0));

    expect(bench).toHaveLength(4);
    expect(bench[0].position).toBe('GKP');
    const outfield = bench.slice(1).map((p) => p.epHorizon);
    // Descending, because auto-subs take the first eligible bench player. Ascending order would
    // send on the worst substitute first, which is the bug this asserts against.
    expect(outfield).toEqual([...outfield].sort((a, b) => b - a));
  });

  it("attaches the model's per-term evidence to every player", async () => {
    const { service } = build(
      squad('mine', () => 5),
      squad('opt', () => 9),
    );
    const advice = await service.adviseManager(42);

    expect(advice.players).toHaveLength(15);
    for (const p of advice.players) {
      expect(p.evidence).not.toBeNull();
      expect(Object.keys(p.evidence!.components).length).toBeGreaterThan(0);
      expect(p.evidence!.playProbability).toBeGreaterThan(0);
    }
  });
});

describe('InsightsService — what it refuses to answer', () => {
  it('states its CURRENT limits in the payload, and stops refusing what it now answers', async () => {
    const { service } = build(
      squad('mine', () => 5),
      squad('opt', () => 9),
    );
    const advice = await service.adviseManager(42);

    // The list is non-empty and names the limits that are CURRENTLY true. It used to refuse
    // transfers and chips; B-008 answers both at `GET /insights/transfers/{managerId}`, and a list
    // that still refused them would have the app telling a user it cannot do something it does on
    // the next screen. What must not happen is the list emptying — a payload that claims no limits
    // is the one shape this field exists to prevent.
    expect(advice.notAdvisedOn.length).toBeGreaterThan(0);
    expect(advice.notAdvisedOn.join(' ')).toMatch(/Uncertainty/);
    expect(advice.notAdvisedOn.join(' ')).not.toMatch(
      /Transfers — needs sell value/,
    );
  });
});
