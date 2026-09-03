import highsLoader from 'highs';
import type { Candidate } from '../../optimizer/ilp';
import { NO_CONCENTRATION } from '../../optimizer/ilp';
import type { Universe } from '../../optimizer/optimizer.service';
import { Rules } from '../../optimizer/rules';
import type { SquadDto } from '../../squad/dto/squad.dto';
import { SquadError } from '../../squad/squad.errors';
import { TransfersService } from '../transfers.service';

/**
 * The plan for a fifteen nobody has bought (B-045), against a synthetic universe and the real
 * solver.
 *
 * What is under test is the *pricing* of a built squad and the two stated inputs, not the LP —
 * `transfer-lp.spec.ts` owns that. Each check here is one a plausible wrong implementation would
 * pass silently: a built squad labelled `unknown` (the panel would warn about an exact number), a
 * stated bank that the budget row never saw (the plan would spend money the user said they do not
 * have), a stated free-transfer count that never reached the hit row (a −4 priced as free).
 */

const RULES = new Rules(
  {
    squad_squadsize: 15,
    squad_squadplay: 11,
    squad_total_spend: 1000,
    squad_team_limit: 3,
    max_extra_free_transfers: 4,
  },
  [
    { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
    { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
    { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
    { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
  ],
);

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

/** Fifteen at £5.0m each, 10 horizon points each: Σ cost 750, so the budget leaves £25.0m. */
const OWNED: Candidate[] = SHAPE.map((position, i) => ({
  key: `p_own${i}`,
  playerId: `own${i}`,
  webName: `own${i}`,
  position,
  teamId: `t${i % 8}`,
  teamShortName: `T${i % 8}`,
  cost: 50,
  ep: 10,
  pPlay: 1,
  appearances: 50,
}));

/**
 * Two upgrades worth more than a hit each and one worth less, all at £6.0m — affordable from the
 * default bank only. The marginal one is the tell: a solver that was handed the stated free
 * transfers takes it when it is free and refuses it when it costs four.
 */
const MARKET: Candidate[] = [
  {
    key: 'p_def',
    playerId: 'def',
    webName: 'def',
    position: 'DEF',
    teamId: 't11',
    teamShortName: 'T11',
    cost: 60,
    ep: 13,
    pPlay: 1,
    appearances: 50,
  },
  {
    key: 'p_mid',
    playerId: 'mid',
    webName: 'mid',
    position: 'MID',
    teamId: 't9',
    teamShortName: 'T9',
    cost: 60,
    ep: 20,
    pPlay: 1,
    appearances: 50,
  },
  {
    key: 'p_fwd',
    playerId: 'fwd',
    webName: 'fwd',
    position: 'FWD',
    teamId: 't10',
    teamShortName: 'T10',
    cost: 60,
    ep: 18,
    pPlay: 1,
    appearances: 50,
  },
];

const UNIVERSE: Universe = {
  candidates: [...OWNED, ...MARKET],
  rules: RULES,
  gameweekIds: [3, 4, 5, 6, 7],
  modelVersion: 'test-model',
  concentration: NO_CONCENTRATION,
};

/** What `SquadService.asSquadDto` returns for the fifteen: bank = budget − Σ cost. */
function builtDto(): SquadDto {
  const teamValue = OWNED.reduce((s, c) => s + c.cost, 0);
  return {
    managerId: null,
    managerName: null,
    gameweekId: 3,
    bank: RULES.budget() - teamValue,
    teamValue,
    activeChip: null,
    source: 'built',
    picks: OWNED.map((c, i) => ({
      playerId: c.playerId,
      fplId: 1000 + i,
      webName: c.webName,
      position: c.position,
      teamShortName: c.teamShortName,
      nowCost: c.cost,
      sellValue: null,
      slot: i + 1,
      multiplier: 1,
      isCaptain: false,
      isViceCaptain: false,
    })),
  };
}

function build(legal = true) {
  const optimizer = {
    buildUniverse: jest.fn().mockResolvedValue(UNIVERSE),
    run: jest.fn().mockResolvedValue({ squad: OWNED }),
  };
  const squads = {
    validateSquad: jest.fn().mockResolvedValue(
      legal
        ? { legal: true, violations: [] }
        : {
            legal: false,
            violations: [{ message: 'Four players from T1; the limit is 3.' }],
          },
    ),
    asSquadDto: jest.fn().mockResolvedValue(builtDto()),
  };
  const repo = { fixtureCounts: jest.fn().mockResolvedValue([]) };
  const service = new TransfersService(
    optimizer as never,
    squads as never,
    {} as never,
    repo as never,
  );
  return { service, optimizer, squads };
}

beforeAll(async () => {
  // Warm the WASM once so the first test's timing is not the loader's.
  await highsLoader();
});

describe('a plan from a hand-built fifteen', () => {
  it('prices every player at market, says so, and reports nothing as unknown', async () => {
    const { service } = build();
    const plan = await service.planBuilt(OWNED.map((c) => c.playerId));

    expect(plan.managerId).toBeNull();
    expect(plan.freeTransfersSource).toBe('stated');
    expect(plan.freeTransfersReconstructed).toBe(true);
    expect(plan.sellValueUnknown).toEqual([]);
    expect(plan.moves.length).toBeGreaterThan(0);
    for (const move of plan.moves) {
      expect(move.out.sellValueSource).toBe('market-price');
      expect(move.out.sellValue).toBe(move.out.nowCost);
    }
    expect(plan.caveats.some((c) => c.includes('never bought'))).toBe(true);
  });

  it('defaults the bank to what the fifteen leaves of the budget, and a stated bank reaches the budget row', async () => {
    const { service } = build();
    const ids = OWNED.map((c) => c.playerId);

    const defaulted = await service.planBuilt(ids);
    expect(defaulted.bank).toBe(250);
    expect(defaulted.moves.length).toBe(2);

    // Every upgrade costs £1.0m more than the player it replaces. With nothing in the bank none
    // is affordable, so a plan that still makes them has ignored the stated bank.
    const broke = await service.planBuilt(ids, { bank: 0 });
    expect(broke.bank).toBe(0);
    expect(broke.moves).toEqual([]);
    expect(broke.netGainEp).toBe(0);
  });

  it('charges a hit only beyond the stated free transfers', async () => {
    const { service } = build();
    const ids = OWNED.map((c) => c.playerId);

    const one = await service.planBuilt(ids, { freeTransfers: 1 });
    expect(one.freeTransfers).toBe(1);
    expect(one.moves.length).toBe(2);
    expect(one.hits).toBe(1);
    expect(one.hitCost).toBe(4);

    const two = await service.planBuilt(ids, { freeTransfers: 2 });
    expect(two.freeTransfers).toBe(2);
    expect(two.moves.length).toBe(2);
    expect(two.hits).toBe(0);
    // Same moves, one hit fewer: the plans differ by exactly the hit.
    expect(two.netGainEp - one.netGainEp).toBeCloseTo(4, 6);

    // The marginal upgrade gains 3, under the hit. Only a solver that SAW three free transfers
    // takes it — a count that stopped at the service's own arithmetic would leave it behind and
    // still report the right hit count for the two moves it did make.
    const three = await service.planBuilt(ids, { freeTransfers: 3 });
    expect(three.moves.length).toBe(3);
    expect(three.hits).toBe(0);
    expect(three.moves.some((m) => m.in.webName === 'def')).toBe(true);
    expect(one.moves.some((m) => m.in.webName === 'def')).toBe(false);
  });

  it('caps a stated count at the bank FPL allows', async () => {
    const { service } = build();
    const plan = await service.planBuilt(
      OWNED.map((c) => c.playerId),
      { freeTransfers: 9 },
    );
    expect(plan.freeTransfers).toBe(RULES.freeTransferCap());
  });

  it('refuses an illegal fifteen before any solve', async () => {
    const { service, optimizer } = build(false);
    await expect(
      service.planBuilt(OWNED.map((c) => c.playerId)),
    ).rejects.toBeInstanceOf(SquadError);
    expect(optimizer.buildUniverse).not.toHaveBeenCalled();
  });
});
