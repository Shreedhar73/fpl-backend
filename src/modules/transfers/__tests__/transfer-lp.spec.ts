import highsLoader from 'highs';
import { Rules } from '../../optimizer/rules';
import type { Candidate } from '../../optimizer/ilp';
import { buildTransferLp, type OwnedCandidate } from '../transfer-lp';
import {
  reconstructEntryState,
  reconstructPurchasePrices,
  sellValueOf,
} from '../../squad/entry-state';
import type {
  RawEntryHistory,
  RawEntryTransfer,
} from '../../../infra/fpl/fpl.types';

/**
 * B-008 — the transfer planner, and the three ways a planner passes its own tests while being useless.
 *
 *  1. **A planner that never recommends anything always looks safe.** Every "it did not do the wrong
 *     thing" test passes on a planner that does nothing at all. So the suite asserts a plan is FOUND
 *     when one obviously exists.
 *  2. **A sell value that silently equals the market price** removes the whole reason sell value is a
 *     concept, and every arithmetic test still passes. So the reconstruction is tested on a player
 *     whose price has RISEN, where the two numbers must differ.
 *  3. **A hit that is never taken** is indistinguishable from a hit that was never worth taking. So
 *     there is a case where it is plainly worth it, and the planner must take it.
 */

const RULES = new Rules(
  {
    squad_squadsize: 15,
    squad_squadplay: 11,
    squad_total_spend: 1000,
    squad_team_limit: 3,
    max_extra_free_transfers: 4,
    transfers_sell_on_fee: 0.5,
  },
  [
    { position: 'GKP', squadSelect: 2, squadMinPlay: 1, squadMaxPlay: 1 },
    { position: 'DEF', squadSelect: 5, squadMinPlay: 3, squadMaxPlay: 5 },
    { position: 'MID', squadSelect: 5, squadMinPlay: 2, squadMaxPlay: 5 },
    { position: 'FWD', squadSelect: 3, squadMinPlay: 1, squadMaxPlay: 3 },
  ],
);

const SHAPE = [
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
] as const;

function ownedSquad(epOf: (i: number) => number): OwnedCandidate[] {
  return SHAPE.map((position, i) => ({
    key: `own${i}`,
    playerId: `own${i}`,
    webName: `Own ${i}`,
    position,
    teamId: `t${i % 10}`,
    teamShortName: `T${i % 10}`,
    cost: 50,
    ep: epOf(i),
    pPlay: 0.9,
    appearances: 50,
    sellValue: 50,
  }));
}

/** A market player of a given position, priced so the swap is affordable unless stated otherwise. */
const marketPlayer = (
  id: string,
  position: (typeof SHAPE)[number],
  ep: number,
  cost = 50,
  teamId = 'tMarket',
): Candidate => ({
  key: id,
  playerId: id,
  webName: id,
  position,
  teamId,
  teamShortName: teamId.toUpperCase(),
  cost,
  ep,
  pPlay: 0.9,
  appearances: 50,
});

async function solve(lp: string) {
  const highs = await highsLoader();
  const solution = highs.solve(lp);
  expect(solution.Status).toBe('Optimal');
  // The union HiGHS returns does not narrow to the MIP column without a cast; the same shape the
  // optimizer guards spec uses.
  const taken = (key: string) =>
    ((solution.Columns[key] as { Primal?: number } | undefined)?.Primal ?? 0) >
    0.5;
  return { solution, taken };
}

describe('the transfer LP', () => {
  /** CHECK 1: a planner that recommends nothing passes every negative test. */
  it('finds the obvious upgrade when one exists', async () => {
    const owned = ownedSquad((i) => (i === 13 ? 2 : 10));
    const market = [marketPlayer('star', 'FWD', 20)];

    const { taken } = await solve(
      buildTransferLp({
        owned,
        market,
        rules: RULES,
        bank: 0,
        freeTransfers: 1,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );

    expect(taken('star')).toBe(true);
    expect(taken('own13')).toBe(false);
    // And it changed nothing else — a free transfer buys one move, not a reshuffle.
    expect(
      owned.filter((c) => c.key !== 'own13').every((c) => taken(c.key)),
    ).toBe(true);
  });

  it('holds when no move is an improvement', async () => {
    const owned = ownedSquad(() => 10);
    const market = [marketPlayer('worse', 'FWD', 4)];

    const { taken } = await solve(
      buildTransferLp({
        owned,
        market,
        rules: RULES,
        bank: 0,
        freeTransfers: 1,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );
    expect(taken('worse')).toBe(false);
    expect(owned.every((c) => taken(c.key))).toBe(true);
  });

  /** CHECK 3, both directions — the hit is a trade-off and not a wall. */
  describe('the hit is inside the objective', () => {
    const owned = () => ownedSquad((i) => (i >= 12 ? 2 : 10));

    it('takes a second transfer when it gains MORE than the hit', async () => {
      const market = [
        marketPlayer('a', 'FWD', 20),
        marketPlayer('b', 'FWD', 20),
      ];
      const { taken } = await solve(
        buildTransferLp({
          owned: owned(),
          market,
          rules: RULES,
          bank: 0,
          freeTransfers: 1,
          hitCost: 4,
          maxTransfers: 3,
        }),
      );
      // Each swap gains 18 against a 4-point hit for the second.
      expect(taken('a')).toBe(true);
      expect(taken('b')).toBe(true);
    });

    it('declines the second transfer when it gains LESS than the hit', async () => {
      const market = [
        marketPlayer('a', 'FWD', 20),
        marketPlayer('b', 'FWD', 4.5),
      ];
      const { taken } = await solve(
        buildTransferLp({
          owned: owned(),
          market,
          rules: RULES,
          bank: 0,
          freeTransfers: 1,
          hitCost: 4,
          maxTransfers: 3,
        }),
      );
      expect(taken('a')).toBe(true);
      // +2.5 against a −4 hit. A planner that took this one is not pricing the hit at all.
      expect(taken('b')).toBe(false);
    });

    it('takes both for free when two free transfers are in hand', async () => {
      const market = [
        marketPlayer('a', 'FWD', 20),
        marketPlayer('b', 'FWD', 4.5),
      ];
      const { taken } = await solve(
        buildTransferLp({
          owned: owned(),
          market,
          rules: RULES,
          bank: 0,
          freeTransfers: 2,
          hitCost: 4,
          maxTransfers: 3,
        }),
      );
      expect(taken('a')).toBe(true);
      expect(taken('b')).toBe(true);
    });
  });

  it('spends only what selling actually returns, not the market price', async () => {
    // Every owned player sells for 40 and is priced at 50 — a squad whose value has FALLEN. With an
    // empty bank the manager can afford a 40 replacement and not a 50 one, and a planner that used
    // market prices would think both were affordable.
    const owned = ownedSquad((i) => (i === 13 ? 2 : 10)).map((c) => ({
      ...c,
      sellValue: 40,
    }));

    const affordable = await solve(
      buildTransferLp({
        owned,
        market: [marketPlayer('cheap', 'FWD', 20, 40)],
        rules: RULES,
        bank: 0,
        freeTransfers: 1,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );
    expect(affordable.taken('cheap')).toBe(true);

    const tooDear = await solve(
      buildTransferLp({
        owned,
        market: [marketPlayer('dear', 'FWD', 20, 50)],
        rules: RULES,
        bank: 0,
        freeTransfers: 1,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );
    expect(tooDear.taken('dear')).toBe(false);
  });

  it('will not break the three-per-club cap to make an upgrade', async () => {
    const owned = ownedSquad((i) => (i === 13 ? 2 : 10));
    // Three of the owned squad are already at t0 (indices 0, 10 — and the market player joins them).
    const crowded = owned.map((c, i) =>
      i < 3 ? { ...c, teamId: 'tFull', teamShortName: 'FUL' } : c,
    );
    const { taken } = await solve(
      buildTransferLp({
        owned: crowded,
        market: [marketPlayer('fourth', 'FWD', 20, 50, 'tFull')],
        rules: RULES,
        bank: 0,
        freeTransfers: 1,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );
    // Taking him would be a fourth from that club unless one of the three leaves — and only one
    // transfer is free, so the solver must either decline or pay a hit to do both. With a +18 gain
    // against a 4-point hit it should do exactly that, which is the interesting answer either way.
    if (taken('fourth')) {
      const fromClub = crowded
        .filter((c) => c.teamId === 'tFull')
        .filter((c) => taken(c.key)).length;
      expect(fromClub).toBeLessThanOrEqual(2);
    }
  });

  it('respects the cap on how many moves a plan may propose', async () => {
    const owned = ownedSquad(() => 1);
    const market = SHAPE.map((position, i) =>
      marketPlayer(`m${i}`, position, 30, 50, `tm${i % 10}`),
    );
    const { taken } = await solve(
      buildTransferLp({
        owned,
        market,
        rules: RULES,
        bank: 0,
        freeTransfers: 15,
        hitCost: 4,
        maxTransfers: 3,
      }),
    );
    // Every market player is better, so without the cap it would replace all fifteen.
    const bought = market.filter((c) => taken(c.key)).length;
    expect(bought).toBeLessThanOrEqual(3);
    expect(bought).toBeGreaterThan(0);
  });
});

describe('sell value', () => {
  /** CHECK 2: a sell value that quietly equals the market price hides the whole feature. */
  it('keeps half the rise, rounded down — never the whole of it', () => {
    expect(sellValueOf(75, 78)).toBe(76);
    expect(sellValueOf(75, 78)).toBeLessThan(78);
    expect(sellValueOf(50, 51)).toBe(50); // half of 1, rounded down, is 0
    expect(sellValueOf(100, 105)).toBe(102);
  });

  it('eats a fall whole', () => {
    expect(sellValueOf(80, 75)).toBe(75);
    expect(sellValueOf(80, 80)).toBe(80);
  });

  it('is null when the purchase price is unknown, never the market price', () => {
    // The whole of D-014: a null is loud where a wrong number is quiet.
    expect(sellValueOf(null, 75)).toBeNull();
  });
});

describe('purchase-price reconstruction', () => {
  const transfer = (over: Partial<RawEntryTransfer>): RawEntryTransfer => ({
    element_in: 1,
    element_in_cost: 50,
    element_out: 2,
    element_out_cost: 50,
    entry: 1,
    event: 2,
    time: '2026-08-28T12:00:00Z',
    ...over,
  });

  it('takes the price from the transfer log when there is one', () => {
    const out = reconstructPurchasePrices(
      [10],
      [transfer({ element_in: 10, element_in_cost: 71, event: 3 })],
      new Map([[10, 65]]),
    );
    expect(out.get(10)).toEqual({ price: 71, source: 'transfer-log' });
  });

  it('takes the LATEST purchase when a player was bought twice', () => {
    // An earlier price belongs to a spell that has already been sold, and using it would price a
    // sale against money the manager no longer had in that player.
    const out = reconstructPurchasePrices(
      [10],
      [
        transfer({ element_in: 10, element_in_cost: 65, event: 2 }),
        transfer({ element_in: 10, element_in_cost: 71, event: 7 }),
      ],
      new Map(),
    );
    expect(out.get(10)?.price).toBe(71);
  });

  it("falls back to the price in the manager's starting gameweek", () => {
    const out = reconstructPurchasePrices([10], [], new Map([[10, 65]]));
    expect(out.get(10)).toEqual({
      price: 65,
      source: 'starting-gameweek-price',
    });
  });

  it('returns null rather than a plausible number when it has neither', () => {
    const out = reconstructPurchasePrices([10], [], new Map());
    expect(out.get(10)).toEqual({ price: null, source: 'unknown' });
  });
});

describe('free transfers, replayed from the season history', () => {
  const history = (
    rows: { event: number; event_transfers: number }[],
    chips: { name: string; event: number }[] = [],
  ): RawEntryHistory => ({
    current: rows.map((r) => ({
      event: r.event,
      points: 0,
      total_points: 0,
      bank: 0,
      value: 1000,
      event_transfers: r.event_transfers,
      event_transfers_cost: 0,
      points_on_bench: 0,
    })),
    past: [],
    chips: chips.map((c) => ({ ...c, time: '2026-08-01T00:00:00Z' })),
  });

  it('grants one a gameweek and banks the unspent ones', () => {
    const state = reconstructEntryState(
      history([
        { event: 1, event_transfers: 0 },
        { event: 2, event_transfers: 0 },
      ]),
      5,
    );
    // GW1 holds none — the squad-selection window is unlimited. Its grant lands entering GW2, GW2's
    // entering GW3. Two clean gameweeks played, two in hand.
    expect(state.freeTransfers).toBe(2);
    expect(state.complete).toBe(true);
  });

  /**
   * The invariant, stated once for a range rather than pinned at a single point: play through
   * gameweek `n` spending nothing and you hold `min(n, cap)` entering `n + 1`.
   *
   * The bug this replaced (#96) seeded the replay at one and then granted the first gameweek's
   * transfer again, so every answer was one too high. Three of the four cases here would have caught
   * it; the cap saturating at 12 rounds is the one that would not, which is why the old suite —
   * whose unsaturated cases were `n + 1` — passed.
   */
  it.each([
    [1, 1],
    [2, 2],
    [4, 4],
    [12, 5],
  ])('holds min(n, cap) after %i clean gameweeks', (played, expected) => {
    const rows = Array.from({ length: played }, (_, i) => ({
      event: i + 1,
      event_transfers: 0,
    }));
    expect(reconstructEntryState(history(rows), 5).freeTransfers).toBe(
      expected,
    );
  });

  it('subtracts what was spent', () => {
    const state = reconstructEntryState(
      history([
        { event: 1, event_transfers: 0 },
        { event: 2, event_transfers: 2 },
      ]),
      5,
    );
    // GW1: none held, none spent, +1 = 1 entering GW2. GW2: 2 spent against 1 leaves 0 (the second
    // was a hit), +1 = 1 entering GW3.
    expect(state.freeTransfers).toBe(1);
  });

  /**
   * The discriminating case. Above, `Math.max(0, …)` floors the answer at the same number whether the
   * replay seeds at zero or one, so that test passes either way. Spending exactly what is held does
   * not saturate: the old off-by-one reported two here, and a manager acting on it takes a −4 it did
   * not have to.
   */
  it('does not credit a transfer that was spent in full', () => {
    const state = reconstructEntryState(
      history([
        { event: 1, event_transfers: 0 },
        { event: 2, event_transfers: 1 },
      ]),
      5,
    );
    expect(state.freeTransfers).toBe(1);
  });

  /**
   * A wildcard or free hit gameweek does not charge its transfers against the bank. Subtracting them
   * would report zero free transfers to a manager who actually holds two, which is the direction
   * that suppresses advice rather than the one that over-promises — quieter, and still wrong.
   */
  it('does not charge transfers made on a wildcard', () => {
    const state = reconstructEntryState(
      history(
        [
          { event: 1, event_transfers: 0 },
          { event: 2, event_transfers: 9 },
        ],
        [{ name: 'wildcard', event: 2 }],
      ),
      5,
    );
    // Nine transfers on the wildcard cost nothing, so the two gameweeks played still grant two.
    expect(state.freeTransfers).toBe(2);
    expect(state.chipsUsed).toEqual(['wildcard']);
  });

  it('reports an incomplete replay rather than a confident number', () => {
    const state = reconstructEntryState(
      history([
        { event: 1, event_transfers: 0 },
        { event: 4, event_transfers: 0 },
      ]),
      5,
    );
    expect(state.complete).toBe(false);
  });

  it('gives a manager who has played nothing their first free transfer', () => {
    const state = reconstructEntryState(history([]), 5);
    expect(state.freeTransfers).toBe(1);
    expect(state.throughGameweek).toBeNull();
  });
});
