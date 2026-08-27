import { OptimizerRepository } from '../optimizer.repository';
import { MODEL_VERSION } from '../../projections/projections.service';
import { PrismaService } from '../../../infra/prisma/prisma.service';

/**
 * The serving pin (B-037). The served version used to be "the newest row in `projections`", which
 * made every writer of that table a potential silent hijack — the exact reason plan 010's "the
 * harness writes nothing" invariant existed. With candidate rows now written weekly on purpose,
 * the pin is what keeps them from being served: the resolution must return the incumbent's
 * constant no matter what the table's newest row says.
 */
describe('the served model version is pinned', () => {
  const repoWith = (count: number, newestVersion: string) =>
    new OptimizerRepository({
      projection: {
        count: async ({ where }: { where: { modelVersion: string } }) => {
          // the incumbent's rows exist (or not); the newest row is someone else's
          expect(where.modelVersion).toBe(MODEL_VERSION);
          return count;
        },
        findFirst: async () => ({ modelVersion: newestVersion }),
      },
    } as unknown as PrismaService);

  it('returns the incumbent even when a candidate wrote the newest row', async () => {
    const version = await repoWith(
      612,
      'v4-composite-2026-08-27',
    ).latestProjectionModelVersion();
    expect(version).toBe(MODEL_VERSION);
  });

  it('throws when the incumbent has no rows, rather than serving whatever is newest', async () => {
    await expect(
      repoWith(0, 'v4-composite-2026-08-27').latestProjectionModelVersion(),
    ).rejects.toThrow(/no projections for the served version/);
  });
});
