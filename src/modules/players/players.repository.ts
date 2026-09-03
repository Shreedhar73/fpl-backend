import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import type { Position } from '../../generated/prisma/enums';
import { MODEL_VERSION } from '../projections/projections.service';

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

/** The player row as the detail view needs it — the identity and FPL's own season facts. */
export interface PlayerDetailRow {
  playerId: string;
  fplId: number;
  webName: string;
  fullName: string;
  position: Position;
  teamId: string;
  teamShortName: string;
  teamName: string;
  nowCost: number;
  status: string;
  news: string | null;
  chanceOfPlayingNextRound: number | null;
  form: number | null;
  pointsPerGame: number | null;
  seasonMinutes: number;
  seasonStarts: number;
  penaltiesOrder: number | null;
  directFreekicksOrder: number | null;
  cornersOrder: number | null;
}

export interface ProjectionRow {
  gameweekId: number;
  expectedPoints: number;
  expectedMinutes: number;
  playProbability: number;
  sd: number | null;
  pBlank: number | null;
  pHaul: number | null;
  components: Record<string, number>;
}

export interface TeamFixtureRow {
  gameweekId: number;
  opponentShortName: string;
  isHome: boolean;
  difficulty: number;
  kickoffTime: Date | null;
}

export interface RecentStatRow {
  gameweekId: number;
  opponentShortName: string;
  wasHome: boolean;
  minutes: number;
  points: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  expectedGoals: number;
  expectedAssists: number;
}

export interface SeasonTotalsRow {
  appearances: number;
  points: number;
  minutes: number;
  goals: number;
  assists: number;
  cleanSheets: number;
  bonus: number;
  expectedGoals: number;
  expectedAssists: number;
}

export interface PriceBounds {
  first: { cost: number; recordedAt: Date };
  last: { cost: number; recordedAt: Date };
}

const num = (d: { toNumber(): number } | number | null): number | null =>
  d === null ? null : typeof d === 'number' ? d : d.toNumber();

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

  /**
   * The version the app serves — the PINNED incumbent, never "whatever row is newest".
   *
   * This used to be newest-`createdAt`, which meant any writer of `projections` — a candidate
   * being scored prospectively, a backtest — silently became the version the builder priced its
   * picks on, while every advice view served the pin. The optimizer closed the same hole in B-037;
   * plan 030 closes it here. Null, not a throw, when the pin has no rows: the roster is still
   * worth serving with its projections absent, which is what the list did before.
   */
  async servedModelVersion(): Promise<string | null> {
    const n = await this.prisma.projection.count({
      where: { modelVersion: MODEL_VERSION },
    });
    return n === 0 ? null : MODEL_VERSION;
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

  /**
   * The next `n` gameweeks a decision can still be made for — the same clock-read the optimizer
   * uses, so the sheet's horizon is the horizon the advice was solved over.
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

  async detail(playerId: string): Promise<PlayerDetailRow | null> {
    const r = await this.prisma.player.findUnique({
      where: { id: playerId },
      select: {
        id: true,
        fplId: true,
        webName: true,
        firstName: true,
        secondName: true,
        position: true,
        teamId: true,
        nowCost: true,
        status: true,
        news: true,
        chanceOfPlayingNextRound: true,
        form: true,
        pointsPerGame: true,
        seasonMinutes: true,
        seasonStarts: true,
        penaltiesOrder: true,
        directFreekicksOrder: true,
        cornersOrder: true,
        team: { select: { shortName: true, name: true } },
      },
    });
    if (!r) return null;
    return {
      playerId: r.id,
      fplId: r.fplId,
      webName: r.webName,
      fullName: `${r.firstName} ${r.secondName}`.trim(),
      position: r.position,
      teamId: r.teamId,
      teamShortName: r.team.shortName,
      teamName: r.team.name,
      nowCost: r.nowCost,
      status: r.status,
      news: r.news,
      chanceOfPlayingNextRound: r.chanceOfPlayingNextRound,
      form: num(r.form),
      pointsPerGame: num(r.pointsPerGame),
      seasonMinutes: r.seasonMinutes,
      seasonStarts: r.seasonStarts,
      penaltiesOrder: r.penaltiesOrder,
      directFreekicksOrder: r.directFreekicksOrder,
      cornersOrder: r.cornersOrder,
    };
  }

  /** One player's projections over the given gameweeks, under one version, in gameweek order. */
  async horizonProjections(
    playerId: string,
    gameweekIds: number[],
    modelVersion: string,
  ): Promise<ProjectionRow[]> {
    if (gameweekIds.length === 0) return [];
    const rows = await this.prisma.projection.findMany({
      where: { playerId, modelVersion, gameweekId: { in: gameweekIds } },
      orderBy: { gameweekId: 'asc' },
      select: {
        gameweekId: true,
        expectedPoints: true,
        expectedMinutes: true,
        playProbability: true,
        sd: true,
        pBlank: true,
        pHaul: true,
        components: true,
      },
    });
    return rows.map((r) => ({
      gameweekId: r.gameweekId,
      expectedPoints: Number(r.expectedPoints),
      expectedMinutes: Number(r.expectedMinutes),
      playProbability: Number(r.playProbability),
      sd: num(r.sd),
      pBlank: num(r.pBlank),
      pHaul: num(r.pHaul),
      components: (r.components ?? {}) as Record<string, number>,
    }));
  }

  /**
   * A club's fixtures across the horizon, seen from that club's side. `homeDifficulty` is FPL's
   * `team_h_difficulty` — the difficulty FACED BY the home side — so a home player reads the home
   * figure. Confirmed against `fpl-sync/mappers.ts` rather than assumed; the inverted reading looks
   * just as plausible on screen.
   */
  async fixturesForTeam(
    teamId: string,
    gameweekIds: number[],
  ): Promise<TeamFixtureRow[]> {
    if (gameweekIds.length === 0) return [];
    const rows = await this.prisma.fixture.findMany({
      where: {
        gameweekId: { in: gameweekIds },
        OR: [{ homeTeamId: teamId }, { awayTeamId: teamId }],
      },
      orderBy: [{ gameweekId: 'asc' }, { kickoffTime: 'asc' }],
      select: {
        gameweekId: true,
        kickoffTime: true,
        homeTeamId: true,
        homeDifficulty: true,
        awayDifficulty: true,
        homeTeam: { select: { shortName: true } },
        awayTeam: { select: { shortName: true } },
      },
    });
    return rows.map((r) => {
      const isHome = r.homeTeamId === teamId;
      return {
        gameweekId: r.gameweekId as number,
        opponentShortName: isHome ? r.awayTeam.shortName : r.homeTeam.shortName,
        isHome,
        difficulty: isHome ? r.homeDifficulty : r.awayDifficulty,
        kickoffTime: r.kickoffTime,
      };
    });
  }

  /**
   * The last `n` finished matches, newest first. The opponent's name comes off the fixture's two
   * sides rather than a second query on `opponentTeamFplId` — that column is an FPL id, and the
   * join is already there.
   */
  async recentStats(playerId: string, n: number): Promise<RecentStatRow[]> {
    const rows = await this.prisma.playerGameweekStat.findMany({
      where: { playerId, fixture: { finished: true } },
      orderBy: [{ gameweekId: 'desc' }, { fixture: { kickoffTime: 'desc' } }],
      take: n,
      select: {
        gameweekId: true,
        wasHome: true,
        minutes: true,
        totalPoints: true,
        goalsScored: true,
        assists: true,
        cleanSheets: true,
        bonus: true,
        expectedGoals: true,
        expectedAssists: true,
        fixture: {
          select: {
            homeTeam: { select: { shortName: true } },
            awayTeam: { select: { shortName: true } },
          },
        },
      },
    });
    return rows.map((r) => ({
      gameweekId: r.gameweekId,
      opponentShortName: r.wasHome
        ? r.fixture.awayTeam.shortName
        : r.fixture.homeTeam.shortName,
      wasHome: r.wasHome,
      minutes: r.minutes,
      points: r.totalPoints,
      goals: r.goalsScored,
      assists: r.assists,
      cleanSheets: r.cleanSheets,
      bonus: r.bonus,
      expectedGoals: Number(r.expectedGoals),
      expectedAssists: Number(r.expectedAssists),
    }));
  }

  /** Summed in SQL, not in Node. Null before the player has a single stat row. */
  async seasonTotals(playerId: string): Promise<SeasonTotalsRow | null> {
    const agg = await this.prisma.playerGameweekStat.aggregate({
      where: { playerId },
      _count: { _all: true },
      _sum: {
        totalPoints: true,
        minutes: true,
        goalsScored: true,
        assists: true,
        cleanSheets: true,
        bonus: true,
        expectedGoals: true,
        expectedAssists: true,
      },
    });
    if (agg._count._all === 0) return null;
    return {
      appearances: agg._count._all,
      points: agg._sum.totalPoints ?? 0,
      minutes: agg._sum.minutes ?? 0,
      goals: agg._sum.goalsScored ?? 0,
      assists: agg._sum.assists ?? 0,
      cleanSheets: agg._sum.cleanSheets ?? 0,
      bonus: agg._sum.bonus ?? 0,
      expectedGoals: num(agg._sum.expectedGoals) ?? 0,
      expectedAssists: num(agg._sum.expectedAssists) ?? 0,
    };
  }

  async latestOwnership(playerId: string): Promise<number | null> {
    const row = await this.prisma.playerOwnershipHistory.findFirst({
      where: { playerId },
      orderBy: { recordedAt: 'desc' },
      select: { selectedByPercent: true },
    });
    return row ? Number(row.selectedByPercent) : null;
  }

  /** The first and last tracked price. Null with fewer than two rows — one point is not a change. */
  async priceBounds(playerId: string): Promise<PriceBounds | null> {
    const [first, last] = await Promise.all([
      this.prisma.playerPriceHistory.findFirst({
        where: { playerId },
        orderBy: { recordedAt: 'asc' },
        select: { cost: true, recordedAt: true },
      }),
      this.prisma.playerPriceHistory.findFirst({
        where: { playerId },
        orderBy: { recordedAt: 'desc' },
        select: { cost: true, recordedAt: true },
      }),
    ]);
    if (
      !first ||
      !last ||
      first.recordedAt.getTime() === last.recordedAt.getTime()
    )
      return null;
    return { first, last };
  }
}
