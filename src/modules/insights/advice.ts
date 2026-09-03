import type { Candidate } from '../optimizer/ilp';
import type { SquadPlayer } from '../optimizer/optimizer.service';

/**
 * The pure half of the advice: given two arranged squads and the next-gameweek expected points,
 * work out the numbers that go in the comparison. No Prisma, no HTTP, no solver — so the
 * guarantees below can be asserted directly.
 *
 * The guarantee that matters: `horizonGap` is never negative. The optimizer maximises horizon EP
 * over the 15 subject to the rules, so no legal squad can beat it. A negative gap does not mean a
 * user found a better squad — it means the two sides were measured against different numbers, and
 * that is a bug, which is why a test asserts it rather than trusting it.
 */

export interface ArrangedSquad {
  squad: SquadPlayer[];
  formation: string;
}

/** Next-gameweek EP of the best XI with the captain counted twice. */
export function xiNextGwEp(
  arranged: ArrangedSquad,
  epNextGw: (playerId: string) => number,
): number {
  return arranged.squad
    .filter((p) => p.role !== 'bench')
    .reduce(
      (sum, p) => sum + epNextGw(p.playerId) * (p.role === 'captain' ? 2 : 1),
      0,
    );
}

/** Horizon EP summed over all 15 — the optimizer's own objective. */
export function squadHorizonEp(candidates: Candidate[]): number {
  return candidates.reduce((sum, c) => sum + c.ep, 0);
}

export function round2(x: number): number {
  return Math.round(x * 100) / 100;
}

/**
 * The set difference between two squads, in both directions. Not a transfer plan: a transfer costs
 * money and possibly a 4-point hit, and whether one is worth taking is the transfer planner's
 * question (`TransfersService`, for an imported or a hand-built fifteen). Answering it here with a
 * subtraction would be the naive answer nobody re-opens.
 */
export function squadDifference(
  mine: Candidate[],
  optimal: Candidate[],
): {
  optimalHasThatYouDoNot: Candidate[];
  youHaveThatOptimalDoesNot: Candidate[];
} {
  const mineIds = new Set(mine.map((c) => c.playerId));
  const optimalIds = new Set(optimal.map((c) => c.playerId));
  return {
    optimalHasThatYouDoNot: optimal
      .filter((c) => !mineIds.has(c.playerId))
      .sort((a, b) => b.ep - a.ep),
    youHaveThatOptimalDoesNot: mine
      .filter((c) => !optimalIds.has(c.playerId))
      .sort((a, b) => b.ep - a.ep),
  };
}
