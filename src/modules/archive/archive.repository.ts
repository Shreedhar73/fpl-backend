import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { Prisma } from '../../generated/prisma/client';
import { ArchiveGameweekRow } from './archive.mappers';

/**
 * Persistence for the third-party per-gameweek archive (B-007 Phase 2b).
 *
 * Reads nothing on the serving path — the only consumer is the calibration harness. Every write is a
 * whole-season replace, so a re-import after an archive update converges instead of accumulating two
 * versions of the same gameweek.
 */
@Injectable()
export class ArchiveRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** `Player.code` → our internal id, for the players still in the game. */
  async playerIdsByCode(codes: number[]): Promise<Map<number, string>> {
    const rows = await this.prisma.player.findMany({
      where: { code: { in: codes } },
      select: { id: true, code: true },
    });
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  /**
   * Replace one season wholesale.
   *
   * Delete-then-insert rather than upsert: the archive is republished as a unit, and a row that
   * DISAPPEARS upstream (a corrected duplicate, a voided fixture) would survive an upsert forever and
   * quietly stay in the training set.
   */
  async replaceSeason(
    season: string,
    rows: ArchiveGameweekRow[],
    playerIdByCode: Map<number, string>,
  ): Promise<number> {
    const data = rows.map((r) => ({
      season: r.season,
      round: r.round,
      fixture: r.fixture,
      playerCode: r.playerCode,
      // Null when the player has left the league. The fit needs those rows: a striker who moved
      // abroad still tells us what strikers do.
      playerId: playerIdByCode.get(r.playerCode) ?? null,
      webName: r.webName,
      position: r.position,
      teamCode: r.teamCode,
      opponentTeamCode: r.opponentTeamCode,
      wasHome: r.wasHome,
      kickoffTime: r.kickoffTime,
      minutes: r.minutes,
      starts: r.starts,
      totalPoints: r.totalPoints,
      goalsScored: r.goalsScored,
      assists: r.assists,
      cleanSheets: r.cleanSheets,
      goalsConceded: r.goalsConceded,
      ownGoals: r.ownGoals,
      penaltiesSaved: r.penaltiesSaved,
      penaltiesMissed: r.penaltiesMissed,
      yellowCards: r.yellowCards,
      redCards: r.redCards,
      saves: r.saves,
      bonus: r.bonus,
      bps: r.bps,
      defensiveContribution: r.defensiveContribution,
      clearancesBlocksInterceptions: r.clearancesBlocksInterceptions,
      tackles: r.tackles,
      recoveries: r.recoveries,
      expectedGoals: new Prisma.Decimal(r.expectedGoals),
      expectedAssists: new Prisma.Decimal(r.expectedAssists),
      expectedGoalsConceded: new Prisma.Decimal(r.expectedGoalsConceded),
      ictIndex: new Prisma.Decimal(r.ictIndex),
      value: r.value,
      selectedBy: r.selectedBy,
    }));

    await this.prisma.archivePlayerGameweek.deleteMany({ where: { season } });

    // Chunked: one 29k-row insert is a single statement large enough to matter, and a failure
    // halfway through tells you which chunk rather than nothing.
    const CHUNK = 2000;
    let written = 0;
    for (let i = 0; i < data.length; i += CHUNK) {
      const batch = data.slice(i, i + CHUNK);
      const res = await this.prisma.archivePlayerGameweek.createMany({
        data: batch,
      });
      written += res.count;
    }
    return written;
  }

  async countBySeason(): Promise<{ season: string; rows: number }[]> {
    const rows = await this.prisma.archivePlayerGameweek.groupBy({
      by: ['season'],
      _count: { _all: true },
      orderBy: { season: 'asc' },
    });
    return rows.map((r) => ({ season: r.season, rows: r._count._all }));
  }
}
