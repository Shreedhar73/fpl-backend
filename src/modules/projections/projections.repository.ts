import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { PositionCode } from '../fpl-sync/mappers';
import { TeamRating } from './team-strength';

/** A fixture from one team's perspective: its FDR and who it faces. */
export interface FixtureContextRow {
  fdr: number;
  opponentFplId: number;
}

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

  /** For each gameweek in `gwIds`, per team (cuid), the fixtures it plays — FDR and opponent fpl id. */
  async fixtureContexts(
    gwIds: number[],
  ): Promise<Map<string, Map<number, FixtureContextRow[]>>> {
    const [rows, teams] = await Promise.all([
      this.prisma.fixture.findMany({
        where: { gameweekId: { in: gwIds } },
        select: {
          gameweekId: true,
          homeTeamId: true,
          awayTeamId: true,
          homeDifficulty: true,
          awayDifficulty: true,
        },
      }),
      this.prisma.team.findMany({ select: { id: true, fplId: true } }),
    ]);
    const fplByCuid = new Map(teams.map((t) => [t.id, t.fplId]));
    const map = new Map<string, Map<number, FixtureContextRow[]>>();
    const add = (teamId: string, gw: number, row: FixtureContextRow) => {
      const byGw = map.get(teamId) ?? new Map<number, FixtureContextRow[]>();
      const list = byGw.get(gw) ?? [];
      list.push(row);
      byGw.set(gw, list);
      map.set(teamId, byGw);
    };
    for (const f of rows) {
      if (f.gameweekId === null) continue;
      const homeFpl = fplByCuid.get(f.homeTeamId);
      const awayFpl = fplByCuid.get(f.awayTeamId);
      if (homeFpl === undefined || awayFpl === undefined) continue;
      add(f.homeTeamId, f.gameweekId, { fdr: f.homeDifficulty, opponentFplId: awayFpl });
      add(f.awayTeamId, f.gameweekId, { fdr: f.awayDifficulty, opponentFplId: homeFpl });
    }
    return map;
  }

  /** Rolling team attack/defence from `player_gameweek_stats` xG: for and against, per match played. */
  async loadTeamRatings(): Promise<Map<number, TeamRating>> {
    const [teams, players, stats] = await Promise.all([
      this.prisma.team.findMany({ select: { id: true, fplId: true } }),
      this.prisma.player.findMany({ select: { id: true, teamId: true } }),
      this.prisma.playerGameweekStat.findMany({
        select: { playerId: true, fixtureId: true, opponentTeamFplId: true, expectedGoals: true },
      }),
    ]);
    const fplByCuid = new Map(teams.map((t) => [t.id, t.fplId]));
    const teamFplByPlayer = new Map(
      players.map((p) => [p.id, fplByCuid.get(p.teamId)]),
    );

    const xgFor = new Map<number, number>();
    const xgAgainst = new Map<number, number>();
    const matches = new Map<number, Set<string>>();
    for (const s of stats) {
      const teamFpl = teamFplByPlayer.get(s.playerId);
      if (teamFpl === undefined) continue;
      const xg = this.dec(s.expectedGoals);
      xgFor.set(teamFpl, (xgFor.get(teamFpl) ?? 0) + xg);
      xgAgainst.set(s.opponentTeamFplId, (xgAgainst.get(s.opponentTeamFplId) ?? 0) + xg);
      const set = matches.get(teamFpl) ?? new Set<string>();
      set.add(s.fixtureId);
      matches.set(teamFpl, set);
    }

    const out = new Map<number, TeamRating>();
    for (const t of teams) {
      const m = matches.get(t.fplId)?.size ?? 0;
      out.set(t.fplId, {
        fplId: t.fplId,
        matches: m,
        xgForPerMatch: m > 0 ? (xgFor.get(t.fplId) ?? 0) / m : 0,
        xgAgainstPerMatch: m > 0 ? (xgAgainst.get(t.fplId) ?? 0) / m : 0,
      });
    }
    return out;
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
