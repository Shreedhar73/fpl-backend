import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PositionCode } from '../fpl-sync/mappers';

export interface ProjectionRow {
  playerId: string;
  gameweekId: number;
  modelVersion: string;
  expectedPoints: number;
  expectedMinutes: number;
  playProbability: number;
  components: Record<string, number>;
  /** B-017. Null only for a model version that composes no distribution. */
  sd: number | null;
  pBlank: number | null;
  pHaul: number | null;
}

/**
 * The only file in the projections domain that touches PrismaService (fpl-architecture-contract §2):
 * it loads every model input from Postgres and writes the results to `projections`. All modelling
 * lives in the pure functions (`minutes.ts`, `model.ts`) and the service.
 */
@Injectable()
export class ProjectionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private dec(v: Prisma.Decimal | null): number {
    return v === null ? 0 : Number(v);
  }

  /** The next `n` unfinished gameweeks, in order. */
  /**
   * The next `n` gameweeks a decision can still be made for.
   *
   * **`finished: false` is not the same thing, and the difference is destructive.** A gameweek whose
   * deadline has passed is unfinished for as long as its matches are being played — so the old query
   * returned the gameweek in progress, and `pnpm project` would write it. Two consequences, both
   * silent:
   *
   * - `writeProjections` upserts on `(playerId, gameweekId, modelVersion)`, so a run during a
   *   gameweek OVERWRITES the pre-deadline rows for it. Those rows are the record of what the model
   *   said while the decision was still open, and `score:gameweek` grades them as exactly that. A
   *   projection written at half-time, scored as a forecast, flatters every model that has one.
   * - the optimizer would recommend transfers for a gameweek that can no longer take them.
   *
   * So the horizon starts at the first gameweek whose deadline is still ahead. Read against the
   * clock rather than a flag, because `finished` flips at the last whistle and `isNext` is upstream's
   * opinion, refreshed on a sync this query cannot assume has run.
   */
  async horizonGameweeks(n: number): Promise<number[]> {
    const rows = await this.prisma.gameweek.findMany({
      where: { finished: false, deadlineTime: { gt: new Date() } },
      orderBy: { id: 'asc' },
      take: n,
      select: { id: true },
    });
    return rows.map((r) => r.id);
  }

  /** Append-only via upsert on (playerId, gameweekId, modelVersion). */
  async writeProjections(rows: ProjectionRow[]): Promise<number> {
    for (let i = 0; i < rows.length; i += 200) {
      const batch = rows.slice(i, i + 200);
      await this.prisma.$transaction(
        batch.map((r) => {
          const data = {
            expectedPoints: r.expectedPoints,
            expectedMinutes: r.expectedMinutes,
            playProbability: r.playProbability,
            components: r.components as Prisma.InputJsonValue,
            sd: r.sd,
            pBlank: r.pBlank,
            pHaul: r.pHaul,
          };
          return this.prisma.projection.upsert({
            where: {
              playerId_gameweekId_modelVersion: {
                playerId: r.playerId,
                gameweekId: r.gameweekId,
                modelVersion: r.modelVersion,
              },
            },
            create: {
              playerId: r.playerId,
              gameweekId: r.gameweekId,
              modelVersion: r.modelVersion,
              ...data,
            },
            update: data,
          });
        }),
        // Prisma's default is 5 s, and a batch of 200 upserts took 25 s on 2026-09-02 while four
        // candidate versions were being written in one run — the availability candidate's rows were
        // lost with a warning and nothing else. The bound is generous because the failure it guards
        // is a silent partial write, not a hang.
        { timeout: 120_000 },
      );
    }
    return rows.length;
  }
}
