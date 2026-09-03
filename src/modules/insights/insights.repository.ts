import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface PlayerMeta {
  playerId: string;
  fplId: number;
  teamId: string;
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
        teamId: true,
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
          teamId: r.teamId,
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

  /**
   * Expected points for a set of players over the horizon, under one version, in one query.
   * Keyed by player then gameweek; a missing inner key is a gameweek the model has no row for,
   * and the service keeps that as null.
   */
  async horizonProjections(
    playerIds: string[],
    gameweekIds: number[],
    modelVersion: string,
  ): Promise<Map<string, Map<number, number>>> {
    if (playerIds.length === 0 || gameweekIds.length === 0) return new Map();
    const rows = await this.prisma.projection.findMany({
      where: {
        playerId: { in: playerIds },
        gameweekId: { in: gameweekIds },
        modelVersion,
      },
      select: { playerId: true, gameweekId: true, expectedPoints: true },
    });
    const out = new Map<string, Map<number, number>>();
    for (const r of rows) {
      let inner = out.get(r.playerId);
      if (!inner) {
        inner = new Map();
        out.set(r.playerId, inner);
      }
      inner.set(r.gameweekId, Number(r.expectedPoints));
    }
    return out;
  }

  /**
   * Every fixture in the horizon for a set of clubs, one query, seen from each club's own side.
   * `homeDifficulty` is FPL's `team_h_difficulty` — the difficulty FACED BY the home side — so a
   * home team reads the home figure (confirmed in `fpl-sync/mappers.ts`, same as the players
   * module's `fixturesForTeam`). A double gameweek is two rows under one (team, gameweek).
   */
  async fixturesForTeams(
    teamIds: string[],
    gameweekIds: number[],
  ): Promise<Map<string, TeamHorizonFixture[]>> {
    if (teamIds.length === 0 || gameweekIds.length === 0) return new Map();
    const rows = await this.prisma.fixture.findMany({
      where: {
        gameweekId: { in: gameweekIds },
        OR: [{ homeTeamId: { in: teamIds } }, { awayTeamId: { in: teamIds } }],
      },
      orderBy: [{ gameweekId: 'asc' }, { kickoffTime: 'asc' }],
      select: {
        gameweekId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeDifficulty: true,
        awayDifficulty: true,
        homeTeam: { select: { shortName: true } },
        awayTeam: { select: { shortName: true } },
      },
    });
    const wanted = new Set(teamIds);
    const out = new Map<string, TeamHorizonFixture[]>();
    const push = (teamId: string, f: TeamHorizonFixture) => {
      if (!wanted.has(teamId)) return;
      const list = out.get(teamId) ?? [];
      list.push(f);
      out.set(teamId, list);
    };
    for (const r of rows) {
      const gameweekId = r.gameweekId as number;
      push(r.homeTeamId, {
        gameweekId,
        opponentShortName: r.awayTeam.shortName,
        isHome: true,
        difficulty: r.homeDifficulty,
      });
      push(r.awayTeamId, {
        gameweekId,
        opponentShortName: r.homeTeam.shortName,
        isHome: false,
        difficulty: r.awayDifficulty,
      });
    }
    return out;
  }
}

export interface TeamHorizonFixture {
  gameweekId: number;
  opponentShortName: string;
  isHome: boolean;
  difficulty: number;
}
