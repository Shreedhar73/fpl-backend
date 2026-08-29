import { ProjectionsRepository } from '../projections.repository';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * The horizon may not include a gameweek whose deadline has gone (#113).
 *
 * `finished: false` used to be the whole filter, and a gameweek in progress satisfies it — so
 * `pnpm project` run on a Saturday would write rows for the gameweek being played. `writeProjections`
 * upserts on `(playerId, gameweekId, modelVersion)`, so those rows REPLACE the pre-deadline ones,
 * and `score:gameweek` then grades a half-time projection as though it had been served before the
 * deadline. Every model with one is flattered, and nothing in any report looks wrong.
 *
 * The test asserts the query, not the result of a run: the failure is a missing clause in a `where`,
 * and the only place it is visible is the `where`.
 */
describe('the projection horizon', () => {
  const captured: { where?: Record<string, unknown> }[] = [];
  const repo = new ProjectionsRepository({
    gameweek: {
      findMany: (args: { where?: Record<string, unknown> }) => {
        captured.push(args);
        return Promise.resolve([{ id: 3 }, { id: 4 }]);
      },
    },
  } as unknown as PrismaService);

  it('asks only for gameweeks whose deadline is still ahead', async () => {
    const ids = await repo.horizonGameweeks(2);
    expect(ids).toEqual([3, 4]);

    const where = captured[0].where as {
      finished: boolean;
      deadlineTime: { gt: Date };
    };
    expect(where.finished).toBe(false);
    // The clause that does the work. Without it the gameweek in progress is inside the horizon.
    expect(where.deadlineTime.gt).toBeInstanceOf(Date);
    expect(where.deadlineTime.gt.getTime()).toBeLessThanOrEqual(Date.now());
    expect(where.deadlineTime.gt.getTime()).toBeGreaterThan(
      Date.now() - 60_000,
    );
  });
});
