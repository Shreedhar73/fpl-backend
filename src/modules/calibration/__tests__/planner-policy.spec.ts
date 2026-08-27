import highsLoader from 'highs';
import { Rules } from '../../optimizer/rules';
import { PredictionRow } from '../harness';
import { predictionRow } from './prediction-row';
import { plannerPolicy, simulateSeason, SimOptions } from '../season-sim';

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

const row = (over: Partial<PredictionRow>): PredictionRow =>
  predictionRow({
    actual: 2,
    minutes: 90,
    predicted: { model: 2, form: 2, priorSeason: 2 },
    horizonEp: 2,
    appearances: 20,
    value: 45,
    ...over,
  });

/** A market of `n` per position over enough clubs; the first fifteen are a legal squad. */
function market(
  round: number,
  over: (i: number) => Partial<PredictionRow> = () => ({}),
): PredictionRow[] {
  const spec: [string, number][] = [
    ['GKP', 4],
    ['DEF', 10],
    ['MID', 10],
    ['FWD', 6],
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
          teamCode: Math.floor(i / 2) + 1,
          ...over(i),
        }),
      );
      i++;
    }
  }
  return out;
}

/** The legal fifteen at the front of that market: 2 GKP, 5 DEF, 5 MID, 3 FWD. */
const opening = (rows: PredictionRow[]): PredictionRow[] => {
  const take = (position: string, n: number) =>
    rows.filter((r) => r.position === position).slice(0, n);
  return [
    ...take('GKP', 2),
    ...take('DEF', 5),
    ...take('MID', 5),
    ...take('FWD', 3),
  ];
};

const asRounds = (...rounds: PredictionRow[][]) =>
  new Map(
    rounds.map((rs, i) => [
      rs[0]?.round ?? i + 1,
      new Map(rs.map((r) => [r.playerCode, r])),
    ]),
  );

describe('the shipped transfer planner as a season policy (B-032)', () => {
  let solve: (lp: string) => ReturnType<
    Awaited<ReturnType<typeof highsLoader>>['solve']
  >;
  beforeAll(async () => {
    const highs = await highsLoader();
    solve = (lp) => highs.solve(lp);
  });
  const planner = () =>
    plannerPolicy(solve, { hitCost: 4, maxTransfers: 3 });

  // The leak guard, and it is the reason this policy exists rather than a convenience. A planner
  // silently demoted to a one-week horizon takes almost no hits and reads as a cautious planner.
  it('refuses to run on rows with no horizon rather than falling back to one round', () => {
    const rows = market(1, () => ({ horizonEp: null }));
    expect(() =>
      simulateSeason(
        asRounds(rows),
        opening(rows),
        'model',
        RULES,
        planner(),
        OPTIONS,
      ),
    ).toThrow(/no horizon/);
  });

  it('holds when nothing on the market is better', () => {
    const rows = market(1);
    const result = simulateSeason(
      asRounds(rows, market(2)),
      opening(rows),
      'model',
      RULES,
      planner(),
      OPTIONS,
    );
    expect(result.totalTransfers).toBe(0);
    expect(result.totalHitCost).toBe(0);
  });

  // The whole design of `buildTransferLp` is that the −4 is inside the objective. A planner that
  // never takes one is indistinguishable from a planner that cannot.
  it('takes a hit when the horizon says a player is worth more than four points', () => {
    // Five unowned midfielders (indices 19-23) are worth twenty times what the squad holds, and the
    // planner starts with one free transfer. Anything past the first costs four.
    const boost = (i: number) => (i >= 19 && i <= 23 ? { horizonEp: 40 } : {});
    const rows = market(1, boost);
    const result = simulateSeason(
      asRounds(rows, market(2, boost)),
      opening(rows),
      'model',
      RULES,
      planner(),
      OPTIONS,
    );
    expect(result.totalTransfers).toBeGreaterThan(1);
    expect(result.totalHitCost).toBeGreaterThan(0);
  });

  it('declines the same upgrade when it is worth less than the hit', () => {
    // The same unowned midfielders, marginally better — nowhere near four points over the horizon.
    const nudge = (i: number) => (i >= 19 && i <= 23 ? { horizonEp: 2.3 } : {});
    const rows = market(1, nudge);
    const result = simulateSeason(
      asRounds(rows, market(2, nudge)),
      opening(rows),
      'model',
      RULES,
      planner(),
      OPTIONS,
    );
    expect(result.totalHitCost).toBe(0);
  });

  it('never swaps positions — the squad shape survives a season', () => {
    const rows = market(1, (i) => ({ horizonEp: 2 + (i % 7) }));
    const result = simulateSeason(
      asRounds(
        rows,
        market(2, (i) => ({ horizonEp: 2 + ((i + 3) % 7) })),
        market(3, (i) => ({ horizonEp: 2 + ((i + 5) % 7) })),
      ),
      opening(rows),
      'model',
      RULES,
      planner(),
      OPTIONS,
    );
    // simulateSeason asserts the position match itself; reaching here at all is the check, and the
    // squad must still be fifteen.
    expect(result.rounds.at(-1)!.squad).toHaveLength(15);
  });

  it('respects the move cap, so a plan never becomes an unannounced wildcard', () => {
    // Every unowned player is worth fifty times the squad, so only the cap can stop the solver.
    const owned = new Set([0, 1, 4, 5, 6, 7, 8, 14, 15, 16, 17, 18, 24, 25, 26]);
    const boost = (i: number) => (owned.has(i) ? {} : { horizonEp: 99 });
    const rows = market(1, boost);
    const result = simulateSeason(
      asRounds(rows, market(2, boost)),
      opening(rows),
      'model',
      RULES,
      plannerPolicy(solve, { hitCost: 4, maxTransfers: 3 }),
      OPTIONS,
    );
    for (const r of result.rounds) expect(r.transfersMade).toBeLessThanOrEqual(3);
  });

  // The sabotage the entry asked for: a planner reading noise must not beat one reading the model.
  it('loses to a planner reading the real numbers when its horizon is shuffled', () => {
    const truth = (i: number) => 2 + (i % 11);
    const rounds = [1, 2, 3, 4, 5];
    const real = rounds.map((r) =>
      market(r, (i) => ({ horizonEp: truth(i), actual: truth(i) })),
    );
    // Same actuals, horizon reversed — the ranking is inverted, the outcomes are not.
    const shuffled = rounds.map((r) =>
      market(r, (i) => ({ horizonEp: truth(40 - i), actual: truth(i) })),
    );
    const run = (rs: PredictionRow[][]) =>
      simulateSeason(
        asRounds(...rs),
        opening(rs[0]),
        'model',
        RULES,
        planner(),
        OPTIONS,
      ).totalPoints;
    expect(run(shuffled)).toBeLessThan(run(real));
  });
});
