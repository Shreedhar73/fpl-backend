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
      expectedGoals:
        r.expectedGoals === null ? null : new Prisma.Decimal(r.expectedGoals),
      expectedAssists:
        r.expectedAssists === null
          ? null
          : new Prisma.Decimal(r.expectedAssists),
      expectedGoalsConceded:
        r.expectedGoalsConceded === null
          ? null
          : new Prisma.Decimal(r.expectedGoalsConceded),
      ictIndex: new Prisma.Decimal(r.ictIndex),
      influence: r.influence === null ? null : new Prisma.Decimal(r.influence),
      creativity:
        r.creativity === null ? null : new Prisma.Decimal(r.creativity),
      threat: r.threat === null ? null : new Prisma.Decimal(r.threat),
      value: r.value,
      selectedBy: r.selectedBy,
    }));

    // One TRANSACTION per season (B-038, watched happen rather than reasoned about): a stale Prisma
    // client after the I/C/T migration made createMany throw AFTER deleteMany had run, and 2023-24
    // was simply gone until a regenerate-and-rerun. An interrupted import must leave the previous
    // season intact, not a hole every consumer of the archive would quietly train around.
    const written = await this.prisma.$transaction(
      async (tx) => {
        await tx.archivePlayerGameweek.deleteMany({ where: { season } });
        // Chunked: one 29k-row insert is a single statement large enough to matter, and a failure
        // halfway through tells you which chunk rather than nothing.
        const CHUNK = 2000;
        let count = 0;
        for (let i = 0; i < data.length; i += CHUNK) {
          const res = await tx.archivePlayerGameweek.createMany({
            data: data.slice(i, i + CHUNK),
          });
          count += res.count;
        }
        return count;
      },
      // 29k rows in 15 chunks comfortably exceeds the 5s default.
      { timeout: 120_000 },
    );
    // Structural, not logged: the import knows how many rows it parsed, and a season whose table
    // count disagrees is an import that must not report success.
    if (written !== data.length) {
      throw new Error(
        `${season}: parsed ${data.length} rows but wrote ${written} — the transaction rolled back`,
      );
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
