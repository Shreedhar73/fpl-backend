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
  async horizonGameweeks(n: number): Promise<number[]> {
    const rows = await this.prisma.gameweek.findMany({
      where: { finished: false },
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
      );
    }
    return rows.length;
  }
}
