import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PositionCode } from '../fpl-sync/mappers';
import { RawScoring } from '../projections/scoring';
import { HistoryRow } from '../projections/features';
import { ForecastRepository } from '../projections/forecast.repository';

/**
 * Reads for the calibration harness. Reads only — the harness writes no projection anywhere
 * (B-007 plan invariant 1).
 */
@Injectable()
export class CalibrationRepository {
  constructor(
    private readonly prisma: PrismaService,
    private readonly forecast: ForecastRepository,
  ) {}

  /**
   * Every archive row for the given seasons, as history.
   *
   * Loaded whole rather than streamed: 87,000 rows is a few tens of MB and the feature walk needs
   * them in round order anyway. If a season is ever added that makes this uncomfortable, the fix is
   * to page by season, not to sample — a sampled backtest measures a different model.
   */
  /** Delegates to the serving path's reader, so backtest and forecast share one definition. */
  async history(seasons: string[]): Promise<HistoryRow[]> {
    return this.forecast.archiveHistory(seasons);
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
