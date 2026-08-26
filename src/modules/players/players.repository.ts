import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Position } from '../../generated/prisma/enums';

export interface PlayerListRow {
  playerId: string;
  fplId: number;
  webName: string;
  position: Position;
  teamShortName: string;
  nowCost: number;
  status: string;
  news: string | null;
}

/** The only file in this module that touches Prisma — fpl-architecture-contract §2. */
@Injectable()
export class PlayersRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every player still in the game, in one query. `removed: false` is the filter that matters: a
   * player FPL has taken out cannot be picked, and offering them would produce a squad the real
   * game rejects.
   *
   * Unpaged on purpose — the row count is bounded by the game (612 in 2025/26), and a picker
   * filters across all of them at once. The two indexes this leans on are already in the schema.
   */
  async listAll(): Promise<PlayerListRow[]> {
    const rows = await this.prisma.player.findMany({
      where: { removed: false },
      orderBy: [{ position: 'asc' }, { nowCost: 'desc' }],
      select: {
        id: true,
        fplId: true,
        webName: true,
        position: true,
        nowCost: true,
        status: true,
        news: true,
        team: { select: { shortName: true } },
      },
    });
    return rows.map((r) => ({
      playerId: r.id,
      fplId: r.fplId,
      webName: r.webName,
      position: r.position,
      teamShortName: r.team.shortName,
      nowCost: r.nowCost,
      status: r.status,
      news: r.news,
    }));
  }

  /** The latest projection model version, or null before anything has been projected. */
  async latestModelVersion(): Promise<string | null> {
    const row = await this.prisma.projection.findFirst({
      orderBy: { createdAt: 'desc' },
      select: { modelVersion: true },
    });
    return row?.modelVersion ?? null;
  }

  /** The first gameweek whose deadline has not passed — the one a picker is picking for. */
  async nextGameweek(): Promise<number | null> {
    const row = await this.prisma.gameweek.findFirst({
      where: { deadlineTime: { gt: new Date() } },
      orderBy: { id: 'asc' },
      select: { id: true },
    });
    return row?.id ?? null;
  }

  async projectionsFor(
    gameweekId: number,
    modelVersion: string,
  ): Promise<Map<string, { expectedPoints: number; playProbability: number }>> {
    const rows = await this.prisma.projection.findMany({
      where: { gameweekId, modelVersion },
      select: {
        playerId: true,
        expectedPoints: true,
        playProbability: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.playerId,
        {
          expectedPoints: Number(r.expectedPoints),
          playProbability: Number(r.playProbability),
        },
      ]),
    );
  }
}
