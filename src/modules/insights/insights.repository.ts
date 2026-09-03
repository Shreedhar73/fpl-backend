import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PlayerMeta {
  playerId: string;
  fplId: number;
  teamShortName: string;
  status: string;
  news: string | null;
  chanceOfPlayingNextRound: number | null;
}

export interface NextGwProjection {
  playerId: string;
  expectedPoints: number;
  expectedMinutes: number;
  playProbability: number;
  components: Record<string, number>;
  /**
   * The points distribution (B-017). Null for a projection written by a model version that composed
   * none — every row before `v3-fitted-2026-08-27`.
   *
   * Null rather than 0 all the way to the UI. A 0 standard deviation is a claim of certainty, and it
   * is the one claim this project has spent three entries learning not to make by accident.
   */
  sd: number | null;
  pBlank: number | null;
  pHaul: number | null;
}

/**
 * The only file in this module that touches Prisma. It loads exactly one thing the optimizer's
 * candidate universe does not carry: the per-term `components` that make a projection explainable.
 * The optimizer only ever needed the total, so asking it for the breakdown would widen its
 * interface for a caller it does not serve.
 */
@Injectable()
export class InsightsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The identifying bits a candidate does not carry: the FPL element id and the club's short name.
   * The optimizer works in internal ids and a team cuid, which is right for solving and useless
   * for rendering.
   */
  async playerMeta(playerIds: string[]): Promise<Map<string, PlayerMeta>> {
    const rows = await this.prisma.player.findMany({
      where: { id: { in: playerIds } },
      select: {
        id: true,
        fplId: true,
        status: true,
        news: true,
        chanceOfPlayingNextRound: true,
        team: { select: { shortName: true } },
      },
    });
    return new Map(
      rows.map((r) => [
        r.id,
        {
          playerId: r.id,
          fplId: r.fplId,
          teamShortName: r.team.shortName,
          status: r.status,
          news: r.news,
          chanceOfPlayingNextRound: r.chanceOfPlayingNextRound,
        },
      ]),
    );
  }

  async projectionsFor(
    playerIds: string[],
    gameweekId: number,
    modelVersion: string,
  ): Promise<Map<string, NextGwProjection>> {
    const rows = await this.prisma.projection.findMany({
      where: { playerId: { in: playerIds }, gameweekId, modelVersion },
      select: {
        playerId: true,
        expectedPoints: true,
        expectedMinutes: true,
        playProbability: true,
        components: true,
        sd: true,
        pBlank: true,
        pHaul: true,
      },
    });
    return new Map(
      rows.map((r) => [
        r.playerId,
        {
          playerId: r.playerId,
          expectedPoints: Number(r.expectedPoints),
          expectedMinutes: Number(r.expectedMinutes),
          playProbability: Number(r.playProbability),
          components: (r.components ?? {}) as Record<string, number>,
          sd: r.sd === null ? null : Number(r.sd),
          pBlank: r.pBlank === null ? null : Number(r.pBlank),
          pHaul: r.pHaul === null ? null : Number(r.pHaul),
        },
      ]),
    );
  }
}
