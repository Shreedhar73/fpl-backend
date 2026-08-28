import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { PositionCode } from '../fpl-sync/mappers';
import { RawScoring } from '../projections/scoring';
import { HistoryRow } from '../projections/features';
import { ForecastRepository } from '../projections/forecast.repository';
import { Rules } from '../optimizer/rules';
import { assertShape, coverageOf } from '../archive/coverage';
import { withImputedStarts } from '../archive/start-imputation';

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
   * The seasons the archive actually holds, in order.
   *
   * Asked of the database rather than read from `ARCHIVE_SEASONS`: that constant says which seasons
   * the importer knows how to fetch, and this says which ones are imported. The rolling-origin
   * referee plans one fold per season and would otherwise plan folds over seasons with no rows —
   * which produces a fold that trains on nothing and reports a number anyway.
   */
  async archiveSeasons(): Promise<string[]> {
    const rows = await this.prisma.archivePlayerGameweek.groupBy({
      by: ['season'],
      orderBy: { season: 'asc' },
    });
    return rows.map((r) => r.season);
  }

  /**
   * Every archive row for the given seasons, as history.
   *
   * Loaded whole rather than streamed: 87,000 rows is a few tens of MB and the feature walk needs
   * them in round order anyway. If a season is ever added that makes this uncomfortable, the fix is
   * to page by season, not to sample — a sampled backtest measures a different model.
   */
  /**
   * Delegates to the serving path's reader, so backtest and forecast share one definition — and
   * checks the shape of what came back before handing it to a fit (B-040, plan 027 task 3).
   *
   * The check belongs HERE, on the read, and not in the importer: the fault it exists for is a column
   * that stops arriving, and by the time a fit is reading rows the import that emptied it has long
   * since reported success. `assertShape` throws; it does not warn. A fit trained on a season whose
   * `starts` column silently emptied produces a start curve fitted on nothing and a report that looks
   * entirely normal.
   */
  async history(seasons: string[]): Promise<HistoryRow[]> {
    const rows = await this.forecast.archiveHistory(seasons);
    assertShape(coverageOf(rows));
    // Attach `startProb` to the rows the archive never labelled (plan 027 task 6). Inert by default:
    // nothing reads it unless a fit is asked for `imputedStarts`, and `starts` itself is untouched,
    // so every scoring path still sees null exactly where the archive has nothing. Calibrated from
    // the rows in hand, so a caller that loads only unlabelled seasons gets no imputation rather
    // than one borrowed from a table it cannot see.
    return withImputedStarts(rows);
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

  /** `optimizer_runs` too — a simulated season is thousands of solves and none may be persisted. */
  async optimizerRunCount(): Promise<number> {
    return this.prisma.optimizerRun.count();
  }

  /**
   * Ownership at one round, for the template squad (B-012 Phase 2).
   *
   * A separate one-shot query rather than a column on `HistoryRow`: that shape is the shared reader
   * for the backtest AND the serving forecast, and ownership is market data that the projection
   * model must never see (`fpl-agent-guide` §2.1 — ownership is not a quality signal). Keeping it
   * out of the row is what stops it leaking into a feature later by being conveniently to hand.
   */
  async ownershipAt(
    season: string,
    round: number,
  ): Promise<Map<number, number>> {
    const rows = await this.prisma.archivePlayerGameweek.findMany({
      where: { season, round },
      select: { playerCode: true, selectedBy: true },
    });
    const out = new Map<number, number>();
    for (const r of rows) {
      // A double gameweek is two rows for one player; ownership is a property of the player that
      // round, not of the fixture, so the larger of the two is the same number.
      out.set(r.playerCode, Math.max(out.get(r.playerCode) ?? 0, r.selectedBy));
    }
    return out;
  }

  /**
   * The squad rules, read from `scoring_config` — never a constant (`fpl-domain-rules`).
   *
   * Same read the optimiser does, so the simulated squad is legal by the same definition the served
   * recommendation is. FPL has changed a squad quota between seasons before; a hardcoded 2/5/5/3 is
   * silently wrong the day it does again.
   */
  async rules(): Promise<Rules> {
    const row = await this.prisma.scoringConfig.findFirst({
      orderBy: { season: 'desc' },
      select: { rules: true, positions: true },
    });
    if (!row) throw new Error('no scoring_config — run `pnpm sync:fpl` first');
    return new Rules(row.rules, row.positions);
  }
}
