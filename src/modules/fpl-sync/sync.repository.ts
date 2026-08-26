import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma, Position } from '../../generated/prisma/client';
import {
  MappedTeam,
  MappedPlayer,
  MappedGameweek,
  MappedFixture,
  MappedOwnership,
  MappedGameweekStat,
  MappedSeasonHistory,
} from './mappers';

/**
 * The only file in the fpl-sync domain that touches PrismaService (fpl-architecture-contract §2).
 *
 * Two invariants live here and nowhere else:
 *  - snapshots are UPSERTED on their natural `fplId`, so a re-run overwrites rather than duplicates;
 *  - history is APPENDED and never updated, and price/ownership rows are written only when the value
 *    actually changed from the last recorded row — which is what makes a re-run idempotent
 *    (fpl-data-model §conventions).
 */
@Injectable()
export class SyncRepository {
  constructor(private readonly prisma: PrismaService) {}

  private chunk<T>(items: T[], size = 200): T[][] {
    const out: T[][] = [];
    for (let i = 0; i < items.length; i += size)
      out.push(items.slice(i, i + size));
    return out;
  }

  async teamIdByFplId(): Promise<Map<number, string>> {
    const rows = await this.prisma.team.findMany({
      select: { fplId: true, id: true },
    });
    return new Map(rows.map((r) => [r.fplId, r.id]));
  }

  async playerIdByFplId(): Promise<Map<number, string>> {
    const rows = await this.prisma.player.findMany({
      select: { fplId: true, id: true },
    });
    return new Map(rows.map((r) => [r.fplId, r.id]));
  }

  async fixtureIdByFplId(): Promise<Map<number, string>> {
    const rows = await this.prisma.fixture.findMany({
      select: { fplId: true, id: true },
    });
    return new Map(rows.map((r) => [r.fplId, r.id]));
  }

  async upsertTeams(teams: MappedTeam[]): Promise<number> {
    for (const batch of this.chunk(teams)) {
      await this.prisma.$transaction(
        batch.map((t) =>
          this.prisma.team.upsert({
            where: { fplId: t.fplId },
            create: t,
            update: {
              code: t.code,
              name: t.name,
              shortName: t.shortName,
              strength: t.strength,
              strengthOverallHome: t.strengthOverallHome,
              strengthOverallAway: t.strengthOverallAway,
              strengthAttackHome: t.strengthAttackHome,
              strengthAttackAway: t.strengthAttackAway,
              strengthDefenceHome: t.strengthDefenceHome,
              strengthDefenceAway: t.strengthDefenceAway,
            },
          }),
        ),
      );
    }
    return teams.length;
  }

  async upsertPlayers(
    players: MappedPlayer[],
    teamId: Map<number, string>,
  ): Promise<number> {
    let written = 0;
    for (const batch of this.chunk(players)) {
      const ops: Prisma.PrismaPromise<unknown>[] = [];
      for (const p of batch) {
        const tid = teamId.get(p.teamFplId);
        if (!tid) continue; // team must exist first; skip rather than orphan
        const data = {
          code: p.code,
          firstName: p.firstName,
          secondName: p.secondName,
          webName: p.webName,
          position: p.position,
          teamId: tid,
          nowCost: p.nowCost,
          status: p.status,
          chanceOfPlayingNextRound: p.chanceOfPlayingNextRound,
          news: p.news,
          newsAddedAt: p.newsAddedAt,
          form: p.form,
          pointsPerGame: p.pointsPerGame,
          epNext: p.epNext,
          epThis: p.epThis,
          expectedGoalsPer90: p.expectedGoalsPer90,
          expectedAssistsPer90: p.expectedAssistsPer90,
          expectedGoalsConcededPer90: p.expectedGoalsConcededPer90,
          defensiveContributionPer90: p.defensiveContributionPer90,
          savesPer90: p.savesPer90,
          startsPer90: p.startsPer90,
          penaltiesOrder: p.penaltiesOrder,
          directFreekicksOrder: p.directFreekicksOrder,
          cornersOrder: p.cornersOrder,
          seasonMinutes: p.seasonMinutes,
          seasonStarts: p.seasonStarts,
        };
        ops.push(
          this.prisma.player.upsert({
            where: { fplId: p.fplId },
            create: { fplId: p.fplId, ...data },
            update: data,
          }),
        );
        written++;
      }
      if (ops.length) await this.prisma.$transaction(ops);
    }
    return written;
  }

  async upsertGameweeks(gws: MappedGameweek[]): Promise<number> {
    for (const batch of this.chunk(gws)) {
      await this.prisma.$transaction(
        batch.map((g) => {
          const { id, ...rest } = g;
          return this.prisma.gameweek.upsert({
            where: { id },
            create: g,
            update: rest,
          });
        }),
      );
    }
    return gws.length;
  }

  async upsertFixtures(
    fixtures: MappedFixture[],
    teamId: Map<number, string>,
  ): Promise<number> {
    let written = 0;
    for (const batch of this.chunk(fixtures)) {
      const ops: Prisma.PrismaPromise<unknown>[] = [];
      for (const f of batch) {
        const home = teamId.get(f.homeTeamFplId);
        const away = teamId.get(f.awayTeamFplId);
        if (!home || !away) continue;
        const data = {
          gameweekId: f.gameweekId,
          kickoffTime: f.kickoffTime,
          homeTeamId: home,
          awayTeamId: away,
          homeScore: f.homeScore,
          awayScore: f.awayScore,
          homeDifficulty: f.homeDifficulty,
          awayDifficulty: f.awayDifficulty,
          started: f.started,
          finished: f.finished,
        };
        ops.push(
          this.prisma.fixture.upsert({
            where: { fplId: f.fplId },
            create: { fplId: f.fplId, ...data },
            update: data,
          }),
        );
        written++;
      }
      if (ops.length) await this.prisma.$transaction(ops);
    }
    return written;
  }

  async upsertScoringConfig(
    season: string,
    scoring: unknown,
    rules: unknown,
    positions: unknown,
  ): Promise<void> {
    const data = {
      scoring: scoring as object,
      rules: rules as object,
      positions: positions as object,
    };
    await this.prisma.scoringConfig.upsert({
      where: { season },
      create: { season, ...data },
      update: data,
    });
  }

  /** Append a price row per player only where `nowCost` differs from that player's latest row. */
  async appendPriceHistory(
    players: MappedPlayer[],
    playerId: Map<number, string>,
    recordedAt: Date,
  ): Promise<number> {
    const latest = await this.prisma.playerPriceHistory.findMany({
      distinct: ['playerId'],
      orderBy: [{ playerId: 'asc' }, { recordedAt: 'desc' }],
      select: { playerId: true, cost: true },
    });
    const lastCost = new Map(latest.map((r) => [r.playerId, r.cost]));
    const rows: { playerId: string; cost: number; recordedAt: Date }[] = [];
    for (const p of players) {
      const pid = playerId.get(p.fplId);
      if (!pid) continue;
      if (lastCost.get(pid) === p.nowCost) continue; // unchanged — skip
      rows.push({ playerId: pid, cost: p.nowCost, recordedAt });
    }
    if (rows.length) {
      await this.prisma.playerPriceHistory.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
    return rows.length;
  }

  /** Append an ownership row per player only where any tracked value changed from the latest row. */
  async appendOwnershipHistory(
    owners: MappedOwnership[],
    playerId: Map<number, string>,
    recordedAt: Date,
  ): Promise<number> {
    const latest = await this.prisma.playerOwnershipHistory.findMany({
      distinct: ['playerId'],
      orderBy: [{ playerId: 'asc' }, { recordedAt: 'desc' }],
      select: {
        playerId: true,
        selectedByPercent: true,
        transfersInEvent: true,
        transfersOutEvent: true,
      },
    });
    const last = new Map(latest.map((r) => [r.playerId, r]));
    const rows: {
      playerId: string;
      selectedByPercent: string;
      transfersInEvent: number;
      transfersOutEvent: number;
      recordedAt: Date;
    }[] = [];
    for (const o of owners) {
      const pid = playerId.get(o.playerFplId);
      if (!pid) continue;
      const prev = last.get(pid);
      const unchanged =
        prev !== undefined &&
        prev.selectedByPercent.toString() === o.selectedByPercent &&
        prev.transfersInEvent === o.transfersInEvent &&
        prev.transfersOutEvent === o.transfersOutEvent;
      if (unchanged) continue;
      rows.push({
        playerId: pid,
        selectedByPercent: o.selectedByPercent,
        transfersInEvent: o.transfersInEvent,
        transfersOutEvent: o.transfersOutEvent,
        recordedAt,
      });
    }
    if (rows.length) {
      await this.prisma.playerOwnershipHistory.createMany({
        data: rows,
        skipDuplicates: true,
      });
    }
    return rows.length;
  }

  /** Idempotent: upsert on (playerId, gameweekId, fixtureId), so a re-backfill overwrites. */
  async upsertGameweekStats(
    stats: MappedGameweekStat[],
    playerId: Map<number, string>,
    fixtureId: Map<number, string>,
  ): Promise<number> {
    let written = 0;
    for (const batch of this.chunk(stats)) {
      const ops: Prisma.PrismaPromise<unknown>[] = [];
      for (const s of batch) {
        const pid = playerId.get(s.playerFplId);
        const fid = fixtureId.get(s.fixtureFplId);
        if (!pid || !fid) continue;
        const data = {
          wasHome: s.wasHome,
          opponentTeamFplId: s.opponentTeamFplId,
          minutes: s.minutes,
          starts: s.starts,
          totalPoints: s.totalPoints,
          goalsScored: s.goalsScored,
          assists: s.assists,
          cleanSheets: s.cleanSheets,
          goalsConceded: s.goalsConceded,
          ownGoals: s.ownGoals,
          penaltiesSaved: s.penaltiesSaved,
          penaltiesMissed: s.penaltiesMissed,
          yellowCards: s.yellowCards,
          redCards: s.redCards,
          saves: s.saves,
          bonus: s.bonus,
          bps: s.bps,
          defensiveContribution: s.defensiveContribution,
          expectedGoals: s.expectedGoals,
          expectedAssists: s.expectedAssists,
          expectedGoalsConceded: s.expectedGoalsConceded,
          ictIndex: s.ictIndex,
          value: s.value,
          selectedBy: s.selectedBy,
        };
        ops.push(
          this.prisma.playerGameweekStat.upsert({
            where: {
              playerId_gameweekId_fixtureId: {
                playerId: pid,
                gameweekId: s.gameweekId,
                fixtureId: fid,
              },
            },
            create: {
              playerId: pid,
              gameweekId: s.gameweekId,
              fixtureId: fid,
              ...data,
            },
            update: data,
          }),
        );
        written++;
      }
      if (ops.length) await this.prisma.$transaction(ops);
    }
    return written;
  }

  /** Upsert a player's prior-season totals on (playerId, season). Idempotent. */
  async upsertSeasonHistory(
    entries: { playerId: string; seasons: MappedSeasonHistory[] }[],
  ): Promise<number> {
    let written = 0;
    const flat = entries.flatMap((e) =>
      e.seasons.map((s) => ({ playerId: e.playerId, s })),
    );
    for (const batch of this.chunk(flat)) {
      const ops = batch.map(({ playerId, s }) => {
        const data = {
          totalPoints: s.totalPoints,
          minutes: s.minutes,
          starts: s.starts,
          goalsScored: s.goalsScored,
          assists: s.assists,
          cleanSheets: s.cleanSheets,
          goalsConceded: s.goalsConceded,
          saves: s.saves,
          bonus: s.bonus,
          bps: s.bps,
          defensiveContribution: s.defensiveContribution,
          expectedGoals: s.expectedGoals,
          expectedAssists: s.expectedAssists,
          expectedGoalsConceded: s.expectedGoalsConceded,
          startCost: s.startCost,
          endCost: s.endCost,
        };
        return this.prisma.playerSeasonHistory.upsert({
          where: { playerId_season: { playerId, season: s.season } },
          create: { playerId, season: s.season, ...data },
          update: data,
        });
      });
      if (ops.length) await this.prisma.$transaction(ops);
      written += ops.length;
    }
    return written;
  }

  // --- SyncRun accounting ---------------------------------------------------

  async startRun(
    endpoint: string,
    mode: string,
  ): Promise<{ id: string; startedAt: Date }> {
    const run = await this.prisma.syncRun.create({
      data: { endpoint, mode, status: 'running' },
      select: { id: true, startedAt: true },
    });
    return run;
  }

  async finishRun(
    id: string,
    result: {
      rowsWritten: number;
      status: string;
      payloadHash?: string;
      error?: string;
    },
  ): Promise<void> {
    await this.prisma.syncRun.update({
      where: { id },
      data: {
        finishedAt: new Date(),
        rowsWritten: result.rowsWritten,
        status: result.status,
        payloadHash: result.payloadHash,
        error: result.error,
      },
    });
  }

  /** The payload hash of the most recent successful/skipped run for an endpoint, or null. */
  async lastGoodHash(endpoint: string): Promise<string | null> {
    const row = await this.prisma.syncRun.findFirst({
      where: {
        endpoint,
        status: { in: ['success', 'skipped'] },
        payloadHash: { not: null },
      },
      orderBy: { startedAt: 'desc' },
      select: { payloadHash: true },
    });
    return row?.payloadHash ?? null;
  }
}
