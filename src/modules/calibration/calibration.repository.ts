import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PositionCode } from '../fpl-sync/mappers';
import { RawScoring } from '../projections/scoring';
import { HistoryRow } from './features';

/**
 * Reads for the calibration harness. Reads only — the harness writes no projection anywhere
 * (B-007 plan invariant 1).
 */
@Injectable()
export class CalibrationRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Every archive row for the given seasons, as history.
   *
   * Loaded whole rather than streamed: 87,000 rows is a few tens of MB and the feature walk needs
   * them in round order anyway. If a season is ever added that makes this uncomfortable, the fix is
   * to page by season, not to sample — a sampled backtest measures a different model.
   */
  async history(seasons: string[]): Promise<HistoryRow[]> {
    const rows = await this.prisma.archivePlayerGameweek.findMany({
      where: { season: { in: seasons } },
      orderBy: [{ season: 'asc' }, { round: 'asc' }],
      select: {
        season: true,
        round: true,
        fixture: true,
        playerCode: true,
        webName: true,
        position: true,
        teamCode: true,
        opponentTeamCode: true,
        wasHome: true,
        minutes: true,
        starts: true,
        totalPoints: true,
        goalsScored: true,
        assists: true,
        cleanSheets: true,
        goalsConceded: true,
        saves: true,
        bonus: true,
        bps: true,
        defensiveContribution: true,
        expectedGoals: true,
        expectedAssists: true,
        value: true,
      },
    });

    return rows.map((r) => ({
      ...r,
      position: r.position as PositionCode,
      expectedGoals: Number(r.expectedGoals),
      expectedAssists: Number(r.expectedAssists),
    }));
  }

  /**
   * The scoring table to score a season with.
   *
   * Falls back to the live config only when the season has no reconstructed table — and the caller
   * reports which was used, because a season scored with the wrong season's rules is a silent error.
   */
  async liveScoring(): Promise<RawScoring> {
    const row = await this.prisma.scoringConfig.findFirst({
      orderBy: { season: 'desc' },
    });
    if (!row) throw new Error('no scoring_config — run `pnpm sync:fpl` first');
    return row.scoring as unknown as RawScoring;
  }

  async projectionCount(): Promise<number> {
    return this.prisma.projection.count();
  }
}
