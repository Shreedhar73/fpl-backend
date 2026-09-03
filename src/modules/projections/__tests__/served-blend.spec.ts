import { applyServedBlend, PlayerForecast } from '../forecast.service';
import { pmfAt, summarise } from '../distributions';

/**
 * The market blend on the SERVED entries (B-043, plan 029 task 8) — the same arithmetic the
 * harness measured, applied to what `pnpm project` writes. Two invariants: the components still
 * sum to the number served, and a gameweek FPL has published nothing for is left exactly alone.
 */

const entry = (playerCode: number, ep: number): PlayerForecast => ({
  playerCode,
  playerId: `p${playerCode}`,
  webName: `P${playerCode}`,
  position: 'MID',
  nowCost: 50,
  expectedPoints: ep,
  expectedMinutes: 80,
  playProbability: 0.9,
  components: { minutes: ep / 2, goals_scored: ep / 2 },
  distribution: summarise(pmfAt(0)),
  fixtures: 1,
  availabilityFromSnapshot: false,
  status: 'a',
});

const sumComponents = (e: PlayerForecast) =>
  Object.values(e.components).reduce((s, x) => s + x, 0);

describe('the served market blend', () => {
  it('leaves every entry untouched when FPL has published nothing', () => {
    const entries = new Map([
      [1, entry(1, 4)],
      [2, entry(2, 2)],
    ]);
    expect(applyServedBlend(entries, new Map(), 0.5)).toBe(0);
    expect(entries.get(1)!.expectedPoints).toBe(4);
    expect(entries.get(1)!.components.market).toBeUndefined();
  });

  it('keeps the level, moves the order, and carries the move as a component', () => {
    const entries = new Map([
      [1, entry(1, 4)],
      [2, entry(2, 2)],
    ]);
    // ep_next on half the level and in the opposite order.
    const blended = applyServedBlend(
      entries,
      new Map([
        [1, 1],
        [2, 2],
      ]),
      0.5,
    );
    expect(blended).toBe(2);
    const a = entries.get(1)!;
    const b = entries.get(2)!;
    expect(a.expectedPoints + b.expectedPoints).toBeCloseTo(6, 10);
    // Scale is 6/3 = 2: player 1 → 0.5×4 + 0.5×2 = 3, player 2 → 0.5×2 + 0.5×4 = 3.
    expect(a.expectedPoints).toBeCloseTo(3, 10);
    expect(b.expectedPoints).toBeCloseTo(3, 10);
    expect(sumComponents(a)).toBeCloseTo(a.expectedPoints, 10);
    expect(sumComponents(b)).toBeCloseTo(b.expectedPoints, 10);
    expect(a.components.market).toBeCloseTo(-1, 10);
  });

  it('blends only the players FPL priced and levels on those alone', () => {
    const entries = new Map([
      [1, entry(1, 4)],
      [2, entry(2, 2)],
      [3, entry(3, 9)],
    ]);
    applyServedBlend(
      entries,
      new Map([
        [1, 2],
        [2, 1],
      ]),
      1,
    );
    expect(entries.get(3)!.expectedPoints).toBe(9);
    expect(entries.get(1)!.expectedPoints).toBeCloseTo(4, 10);
    expect(entries.get(2)!.expectedPoints).toBeCloseTo(2, 10);
  });
});
