import type { Candidate } from '../../optimizer/ilp';
import type { SquadPlayer } from '../../optimizer/optimizer.service';
import { squadDifference, squadHorizonEp, xiNextGwEp } from '../advice';

const c = (playerId: string, ep: number): Candidate => ({
  key: `p_${playerId}`,
  playerId,
  webName: playerId,
  position: 'MID',
  teamId: 't1',
  cost: 50,
  ep,
  pPlay: 1,
});

const p = (playerId: string, role: SquadPlayer['role']): SquadPlayer => ({
  playerId,
  webName: playerId,
  position: 'MID',
  cost: 50,
  ep: 0,
  role,
});

describe('xiNextGwEp', () => {
  const ep: Record<string, number> = { a: 5, b: 3, c: 2, d: 100 };
  const lookup = (id: string) => ep[id] ?? 0;

  it('counts the captain twice and the bench not at all', () => {
    const arranged = {
      formation: '4-4-2',
      squad: [
        p('a', 'captain'),
        p('b', 'vice'),
        p('c', 'starter'),
        p('d', 'bench'),
      ],
    };
    // 5 doubled, plus 3, plus 2. The 100-point bench player contributes nothing.
    expect(xiNextGwEp(arranged, lookup)).toBe(15);
  });

  it('treats the vice as an ordinary starter — they only matter if the captain blanks', () => {
    const withVice = {
      formation: '4-4-2',
      squad: [p('a', 'captain'), p('b', 'vice')],
    };
    const withoutVice = {
      formation: '4-4-2',
      squad: [p('a', 'captain'), p('b', 'starter')],
    };
    expect(xiNextGwEp(withVice, lookup)).toBe(xiNextGwEp(withoutVice, lookup));
  });

  it('is zero for a squad with no starters, rather than throwing', () => {
    expect(
      xiNextGwEp({ formation: '-', squad: [p('d', 'bench')] }, lookup),
    ).toBe(0);
  });
});

describe('squadHorizonEp', () => {
  it("sums every one of the 15, bench included — it is the optimizer's own objective", () => {
    expect(squadHorizonEp([c('a', 1.5), c('b', 2.25), c('c', 0)])).toBe(3.75);
  });
});

describe('squadDifference', () => {
  const mine = [c('keep', 10), c('mine-only', 4)];
  const optimal = [
    c('keep', 10),
    c('optimal-only-a', 9),
    c('optimal-only-b', 12),
  ];

  it('reports both directions, and only the players that actually differ', () => {
    const d = squadDifference(mine, optimal);
    expect(d.optimalHasThatYouDoNot.map((x) => x.playerId)).toEqual([
      'optimal-only-b',
      'optimal-only-a',
    ]);
    expect(d.youHaveThatOptimalDoesNot.map((x) => x.playerId)).toEqual([
      'mine-only',
    ]);
  });

  it('is empty in both directions for identical squads', () => {
    const d = squadDifference(mine, mine);
    expect(d.optimalHasThatYouDoNot).toHaveLength(0);
    expect(d.youHaveThatOptimalDoesNot).toHaveLength(0);
  });

  it('sorts by expected points, so the biggest difference reads first', () => {
    const d = squadDifference(mine, optimal);
    const eps = d.optimalHasThatYouDoNot.map((x) => x.ep);
    expect(eps).toEqual([...eps].sort((a, b) => b - a));
  });
});
