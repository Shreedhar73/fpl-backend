import { Rules } from '../../optimizer/rules';
import { PredictionRow, sortRows } from '../harness';
import { predictionRow } from './prediction-row';
import {
  GREEDY_ONE_FT,
  simulateSeason,
  SimOptions,
  SquadState,
} from '../season-sim';
import { chooseLineup } from '../xi-decision';

/**
 * B-039 — the simulator is a function of (data, params, config), and of nothing else.
 *
 * **What this guards against, and why it is not obvious.** `PredictionRow[]` arrives from a Prisma
 * read whose `ORDER BY` was not total, so two runs over an unchanged table could return the rows of
 * one gameweek in different orders. That order is not presentation: `Array.prototype.sort` is
 * stable, so every comparator that can return 0 — the XI, the armband, the weekly transfer — breaks
 * its ties on it. Measured 2026-08-28 on the real archive: two `pnpm decision-quality` runs, no code
 * change and no data change, put the `greedy-1ft` `form` arm **165 points apart** and flipped the
 * sign of a conclusion the report prints in prose.
 *
 * **Why every case here shuffles.** A test that runs the same array twice passes on any code at all,
 * including the code that had the bug — the array it is handed is already in one order, which is the
 * one thing the failure needed to vary. The shuffle IS the test. Reverting `sortRows` and watching
 * these go red is part of the procedure (plan 026), not an optional extra.
 *
 * The rows below are built with **deliberate ties** — equal projections, equal prices — because a
 * tie is the only place input order can reach the outcome. A fixture of distinct values would pass
 * against the bug.
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

const OPTIONS: SimOptions = { freeTransferCap: 5, hitCost: 4 };

/**
 * A deterministic shuffle. Not `Math.random()`: a guard that fails one run in ten and passes the
 * next is a guard nobody trusts, and the point here is to vary the order, not to vary it unusually.
 */
function shuffled<T>(xs: T[], seed: number): T[] {
  let state = seed;
  const next = () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state) / 2 ** 31;
  };
  const out = [...xs];
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

const POSITIONS: [string, number][] = [
  // FOUR goalkeepers, two of them owned. The greedy policy scans owned players in squad order and
  // keeps the first move of the best gain it sees, so the tie that input order can actually decide
  // is between two replacements for the SAME owned player. With three keepers there is only one
  // unowned keeper, the move is forced, and the case cannot go red — measured, on the first version
  // of this fixture, by a sabotage that removed the tie-break and stayed green.
  ['GKP', 4],
  ['DEF', 8],
  ['MID', 8],
  ['FWD', 5],
];

/**
 * A round of 24 players, of whom 15 can be owned — so the transfer policy has somewhere to move to.
 *
 * **The ties are the fixture.** Players within a position share a projection and a price, and their
 * realised points differ. So which of two equally-projected players the policy transfers in decides
 * the season's total, and nothing but input order can decide it unless the code names a tie-break.
 */
function roundRows(round: number): PredictionRow[] {
  const out: PredictionRow[] = [];
  let i = 0;
  for (const [position, n] of POSITIONS) {
    for (let k = 0; k < n; k++) {
      const owned = k < (position === 'GKP' ? 2 : position === 'FWD' ? 3 : 5);
      out.push(
        predictionRow({
          round,
          playerCode: 100 + i,
          webName: `${position}-${k}`,
          position,
          // A club each. The three-per-club cap is a real rule and it is tested elsewhere; here it
          // would forbid all but one of the equal-gain moves and leave the transfer tie-break with
          // no tie to break — a case that passes whether or not the tie-break exists.
          teamCode: i + 1,
          value: 45,
          // A tie on purpose: owned players project 2.0, everyone else 2.5, and every member of each
          // group is identical to the others. The policy must choose between equals every round.
          predicted: {
            model: owned ? 2 : 2.5,
            form: owned ? 2 : 2.5,
            priorSeason: owned ? 2 : 2.5,
            v4: null,
          },
          // Realised points vary, so a different choice among equals is a different season total.
          actual: (i * 7) % 11,
          minutes: 90,
          appearances: 20,
          pPlay: 1,
        }),
      );
      i++;
    }
  }
  return out;
}

const SEASON = [1, 2, 3, 4, 5].map(roundRows);

const byRound = (rows: PredictionRow[][]) =>
  new Map(
    rows.map((rs) => [
      rs[0].round,
      new Map(rs.map((r) => [r.playerCode, r])),
    ]),
  );

/** The fifteen the season opens with, in whatever order the caller's rows arrived in. */
const openingFrom = (rows: PredictionRow[]): PredictionRow[] => {
  const want = new Map<string, number>([
    ['GKP', 2],
    ['DEF', 5],
    ['MID', 5],
    ['FWD', 3],
  ]);
  const taken = new Map<string, number>();
  return rows.filter((r) => {
    const n = taken.get(r.position) ?? 0;
    if (n >= (want.get(r.position) ?? 0)) return false;
    taken.set(r.position, n + 1);
    return true;
  });
};

const walk = (rows: PredictionRow[][]) => {
  const canonical = rows.map((rs) => sortRows(rs));
  return simulateSeason(
    byRound(canonical),
    openingFrom(canonical[0]),
    'model',
    RULES,
    GREEDY_ONE_FT,
    OPTIONS,
  );
};

describe('the season walk is a function of the data, not of the row order', () => {
  it('produces identical season rows when the input rows are shuffled', () => {
    const a = walk(SEASON);
    const b = walk(SEASON.map((rs, i) => shuffled(rs, 20260828 + i)));

    // Round by round, not just the total: two paths can cross at the same total and still be
    // different seasons, and a total-only assertion would call that a pass.
    expect(b.rounds).toEqual(a.rounds);
    expect(b.totalPoints).toBe(a.totalPoints);
    expect(b.totalTransfers).toBe(a.totalTransfers);
  });

  it('produces identical season rows under a second, different shuffle', () => {
    // One shuffle can coincidentally reproduce the original order for the rows that matter. Two
    // independent ones failing to separate the walks is a much stronger statement than one.
    const a = walk(SEASON.map((rs, i) => shuffled(rs, 11 + i)));
    const b = walk(SEASON.map((rs, i) => shuffled(rs, 99991 + i)));
    expect(b.rounds).toEqual(a.rounds);
  });

  it('has a fixture that CAN separate two walks — the shuffle is not being wasted', () => {
    // The check on the check (`checks-that-cannot-fail`): if the ties above were not really ties, or
    // the policy never moved, every assertion here would pass against the bug it was written for.
    // A walk whose transfers are removed must reach a different season, or this fixture proves
    // nothing about transfers.
    const withTransfers = walk(SEASON);
    expect(withTransfers.totalTransfers).toBeGreaterThan(0);

    const rows = SEASON.map((rs) => sortRows(rs));
    const sameOpeningNoMoves = simulateSeason(
      byRound(rows),
      openingFrom(rows[0]),
      'model',
      RULES,
      { label: 'none', decide: () => [] },
      OPTIONS,
    );
    expect(sameOpeningNoMoves.totalPoints).not.toBe(withTransfers.totalPoints);
  });
});

describe('sortRows', () => {
  it('is a total order — no two rows of the fixture compare equal', () => {
    // If the key were not total, `sortRows` would leave the tied rows in input order and every
    // assertion above would be guarding nothing.
    const rows = SEASON.flat();
    const keys = sortRows(rows).map(
      (r) =>
        `${r.season}|${r.round}|${r.playerCode}|${r.opponentTeamCode}|${r.wasHome}`,
    );
    expect(new Set(keys).size).toBe(rows.length);
  });

  it('maps any input order onto the same output order', () => {
    const rows = SEASON.flat();
    const a = sortRows(shuffled(rows, 7)).map((r) => r.playerCode);
    const b = sortRows(shuffled(rows, 4242)).map((r) => r.playerCode);
    expect(b).toEqual(a);
  });

  it('does not mutate its argument', () => {
    // It returns a copy on purpose: the callers share row arrays, and a sort in place would reorder
    // an array another consumer is midway through reading.
    const rows = shuffled(SEASON.flat(), 5);
    const before = rows.map((r) => r.playerCode);
    sortRows(rows);
    expect(rows.map((r) => r.playerCode)).toEqual(before);
  });
});


/**
 * The tie-breaks, reached directly.
 *
 * `sortRows` makes the row order canonical, and the cases above go red the moment it stops doing so.
 * That leaves the named tie-breaks — the XI, the armband, the weekly transfer — guarded only
 * *through* it: with the rows already sorted, removing a tie-break changes nothing and every case
 * above still passes. So they are reached here with a shuffled argument instead, which is the only
 * way a test can tell "deterministic because the input was pinned" from "deterministic because the
 * code names its tie-break".
 *
 * Why keep both, when the sort alone fixes the report: one refactor away from a query losing an
 * `ORDER BY` clause or a caller passing rows it assembled itself, the tie-breaks are what stops the
 * 165 points coming back silently. Defence in depth is only defence if something checks the second
 * layer independently.
 */
describe('the named tie-breaks hold on their own, not via sortRows', () => {
  const slots = (rows: PredictionRow[]) =>
    rows.map((r) => ({ row: r, base: r, carried: null }));

  it('picks the same XI and the same captain from a shuffled squad', () => {
    // A legal fifteen in which every player projects exactly 2.0 — so ONLY a tie-break can decide
    // who starts and who wears the armband.
    const fifteen = openingFrom(sortRows(SEASON[0]));
    expect(fifteen).toHaveLength(15);

    const a = chooseLineup(slots(fifteen), 'model', RULES);
    const b = chooseLineup(slots(shuffled(fifteen, 31337)), 'model', RULES);
    const c = chooseLineup(slots(shuffled(fifteen, 6553)), 'model', RULES);

    expect(b.captain).toBe(a.captain);
    expect(b.vice).toBe(a.vice);
    expect(c.captain).toBe(a.captain);
    expect(b.starters.map((m) => m.playerCode).sort((x, y) => x - y)).toEqual(
      a.starters.map((m) => m.playerCode).sort((x, y) => x - y),
    );
    expect(c.starters.map((m) => m.playerCode).sort((x, y) => x - y)).toEqual(
      a.starters.map((m) => m.playerCode).sort((x, y) => x - y),
    );
    expect(b.bench.map((m) => m.playerCode)).toEqual(
      a.bench.map((m) => m.playerCode),
    );
  });

  it('makes the same transfer from a shuffled market', () => {
    // Every unowned player projects 2.5 and every owned one 2.0, so every legal move gains exactly
    // the same amount and the pick is a pure tie.
    const rows = sortRows(SEASON[0]);
    const state: SquadState = {
      owned: openingFrom(rows).map((r) => ({
        playerCode: r.playerCode,
        purchasePrice: r.value,
        position: r.position as 'GKP' | 'DEF' | 'MID' | 'FWD',
      })),
      bank: 200,
      freeTransfers: 1,
    };
    const prices = new Map(rows.map((r) => [r.playerCode, r.value]));

    const decideWith = (rs: PredictionRow[]) =>
      GREEDY_ONE_FT.decide(
        state,
        new Map(rs.map((r) => [r.playerCode, r])),
        prices,
        'model',
        RULES,
      );

    const a = decideWith(rows);
    // The move must exist, or this case asserts that two empty arrays are equal.
    expect(a).toHaveLength(1);

    // And there must be MORE THAN ONE move of the same gain, or the pick is forced and this case
    // passes with or without a tie-break. Counted rather than assumed: the first version of this
    // fixture was forced by the three-per-club cap and stayed green under a sabotage that removed
    // the tie-break outright.
    const owned = new Set(state.owned.map((o) => o.playerCode));
    const firstOwnedPosition = state.owned[0].position;
    const rivals = rows.filter(
      (r) =>
        !owned.has(r.playerCode) &&
        r.position === firstOwnedPosition &&
        r.value <= state.bank + 45,
    );
    expect(rivals.length).toBeGreaterThan(1);
    // FORTY shuffles, not two. The first version of this case used two fixed seeds and stayed green
    // under a sabotage that removed the tie-break outright — both seeds happened to order the two
    // rival keepers the same way. A tie-break test with too few draws is a coin that came up heads.
    const seen = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      seen.add(JSON.stringify(decideWith(shuffled(rows, seed * 7919))));
    }
    expect([...seen]).toEqual([JSON.stringify(a)]);
  });
});
