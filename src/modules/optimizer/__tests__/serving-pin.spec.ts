import { OptimizerRepository } from '../optimizer.repository';
import {
  MODEL_VERSION,
  SHAPE_MODEL_VERSION,
  V3_MODEL_VERSION,
} from '../../projections/projections.service';
import {
  FITTED_PARAMS,
  SHAPE_CANDIDATE_PARAMS,
  V3_INCUMBENT_PARAMS,
} from '../../projections/fitted';
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

  /**
   * The plan 028 shape candidate (D-036) writes weekly rows like every other candidate, so the same
   * pin has to hold against it — and it has to be a genuinely different model, or the live season
   * would be refereeing the incumbent against itself under two names.
   */
  it('does not serve the plan 028 shape candidate either', async () => {
    expect(SHAPE_MODEL_VERSION).not.toBe(MODEL_VERSION);
    const version = await repoWith(
      612,
      SHAPE_MODEL_VERSION,
    ).latestProjectionModelVersion();
    expect(version).toBe(MODEL_VERSION);
  });

  it('is a different model from the v3 incumbent, not a relabelled one', () => {
    expect(SHAPE_CANDIDATE_PARAMS.rates).toBeDefined();
    expect(SHAPE_CANDIDATE_PARAMS.minutes.perPlayerStart).toBe(true);
    expect(V3_INCUMBENT_PARAMS.rates).toBeUndefined();
    expect(V3_INCUMBENT_PARAMS.minutes.perPlayerStart).toBeUndefined();
    // And since D-037 the SERVED params carry the shape too — on a different corpus, under a
    // different version string. The v3 rows keep landing under their own name (V3_MODEL_VERSION).
    expect(FITTED_PARAMS.rates).toEqual(SHAPE_CANDIDATE_PARAMS.rates);
    expect(FITTED_PARAMS.minutes.perPlayerStart).toBe(true);
    expect(FITTED_PARAMS.provenance.fittedOn).not.toEqual(
      V3_INCUMBENT_PARAMS.provenance.fittedOn,
    );
    expect(V3_MODEL_VERSION).not.toBe(MODEL_VERSION);
    expect(V3_MODEL_VERSION).toBe('v3-fitted-2026-08-27-gkp');
    // The rank bonus lost on the referee and is in no candidate. If this ever becomes defined,
    // `forecast.service` and the v3ep export need the fixture pre-pass first — without it the
    // candidate would serve the incumbent's bonus term under its own version string.
    expect(SHAPE_CANDIDATE_PARAMS.bonus.tau).toBeUndefined();
  });
});
