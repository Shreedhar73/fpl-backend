import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PositionCode } from '../fpl-sync/mappers';

/** A player's current-state row plus the season-to-date per-90 rates, as the model needs them. */
export interface PlayerRow {
  id: string;
  fplId: number;
  webName: string;
  teamId: string;
  position: PositionCode;
  status: string;
  chance: number | null;
  seasonMinutes: number;
  seasonStarts: number;
  epNext: number | null;
  xg90: number;
  xa90: number;
  defcon90: number;
  saves90: number;
}

/** Last-two-seasons totals for a player, aggregated. */
export interface PriorAggregate {
  minutes: number;
  starts: number;
  xg: number;
  xa: number;
  defcon: number;
  saves: number;
  totalPoints: number;
  seasons: number;
}

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

  async loadPlayers(): Promise<PlayerRow[]> {
    const rows = await this.prisma.player.findMany({
      where: { removed: false },
      select: {
        id: true,
        fplId: true,
        webName: true,
        teamId: true,
        position: true,
        status: true,
        chanceOfPlayingNextRound: true,
        seasonMinutes: true,
        seasonStarts: true,
        epNext: true,
        expectedGoalsPer90: true,
        expectedAssistsPer90: true,
        defensiveContributionPer90: true,
        savesPer90: true,
      },
    });
    return rows.map((r) => ({
      id: r.id,
      fplId: r.fplId,
      webName: r.webName,
      teamId: r.teamId,
      position: r.position,
      status: r.status,
      chance: r.chanceOfPlayingNextRound,
      seasonMinutes: r.seasonMinutes,
      seasonStarts: r.seasonStarts,
      epNext: r.epNext === null ? null : Number(r.epNext),
      xg90: this.dec(r.expectedGoalsPer90),
      xa90: this.dec(r.expectedAssistsPer90),
      defcon90: this.dec(r.defensiveContributionPer90),
      saves90: this.dec(r.savesPer90),
    }));
  }

  /** Aggregate each player's most recent `lastN` prior seasons into a single prior. */
  async loadPriors(lastN = 2): Promise<Map<string, PriorAggregate>> {
    const rows = await this.prisma.playerSeasonHistory.findMany({
      select: {
        playerId: true,
        season: true,
        minutes: true,
        starts: true,
        totalPoints: true,
        defensiveContribution: true,
        expectedGoals: true,
        expectedAssists: true,
        saves: true,
      },
    });
    const byPlayer = new Map<string, typeof rows>();
    for (const r of rows) {
      const list = byPlayer.get(r.playerId) ?? [];
      list.push(r);
      byPlayer.set(r.playerId, list);
    }
    const out = new Map<string, PriorAggregate>();
    for (const [playerId, list] of byPlayer) {
      const recent = list
        .sort((a, b) => b.season.localeCompare(a.season))
        .slice(0, lastN);
      const agg: PriorAggregate = {
        minutes: 0,
        starts: 0,
        xg: 0,
        xa: 0,
        defcon: 0,
        saves: 0,
        totalPoints: 0,
        seasons: recent.length,
      };
      for (const s of recent) {
        agg.minutes += s.minutes;
        agg.starts += s.starts;
        agg.xg += this.dec(s.expectedGoals);
        agg.xa += this.dec(s.expectedAssists);
        agg.defcon += s.defensiveContribution;
        agg.saves += s.saves;
        agg.totalPoints += s.totalPoints;
      }
      out.set(playerId, agg);
    }
    return out;
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

  async finishedGameweekCount(): Promise<number> {
    return this.prisma.gameweek.count({ where: { finished: true } });
  }

  /** For each gameweek in `gwIds`, a map from teamId to the difficulties it faces (one per fixture). */
  async fixtureDifficulties(
    gwIds: number[],
  ): Promise<Map<string, Map<number, number[]>>> {
    const rows = await this.prisma.fixture.findMany({
      where: { gameweekId: { in: gwIds } },
      select: {
        gameweekId: true,
        homeTeamId: true,
        awayTeamId: true,
        homeDifficulty: true,
        awayDifficulty: true,
      },
    });
    // teamId -> (gwId -> [difficulty, ...])
    const map = new Map<string, Map<number, number[]>>();
    const add = (teamId: string, gw: number, diff: number) => {
      const byGw = map.get(teamId) ?? new Map<number, number[]>();
      const list = byGw.get(gw) ?? [];
      list.push(diff);
      byGw.set(gw, list);
      map.set(teamId, byGw);
    };
    for (const f of rows) {
      if (f.gameweekId === null) continue;
      add(f.homeTeamId, f.gameweekId, f.homeDifficulty);
      add(f.awayTeamId, f.gameweekId, f.awayDifficulty);
    }
    return map;
  }

  async loadScoring(): Promise<unknown> {
    const row = await this.prisma.scoringConfig.findFirst({
      orderBy: { season: 'desc' },
      select: { scoring: true },
    });
    if (!row) throw new Error('no scoring_config row — run the sync first');
    return row.scoring;
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
