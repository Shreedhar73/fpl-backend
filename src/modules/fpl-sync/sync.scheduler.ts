import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncService, SNAPSHOT_WINDOW_HOURS } from './sync.service';
import { ProjectionsService } from '../projections/projections.service';
import { SyncRepository } from './sync.repository';

/**
 * Keeps the public dataset current. Hourly incremental only — `--live` and `--full` stay manual
 * (they are heavy or need a live gameweek), invoked via `pnpm sync:fpl` from the sync-fpl skill.
 *
 * **Projections ride the same tick inside the deadline window (B-037).** The snapshot always rode
 * the sync (B-016); projections never did — they were `pnpm project`, run by hand. A deadline nobody
 * projected before publishes no incumbent row and no candidate row, and `score:gameweek` has
 * nothing to grade for that gameweek: the prospective verdict silently loses a week per forgotten
 * command. So: after each hourly sync, if the next deadline is inside the snapshot window, run
 * projections. The upsert keys make the hourly refresh idempotent, and the final pre-deadline write
 * is the freshest availability — which is exactly the row `score:gameweek` should grade.
 *
 * A locked run guards against overlap if a sync ever runs long enough to meet the next tick.
 */
@Injectable()
export class SyncScheduler {
  private readonly log = new Logger(SyncScheduler.name);
  private running = false;

  constructor(
    private readonly sync: SyncService,
    private readonly projections: ProjectionsService,
    private readonly repo: SyncRepository,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async hourlyIncremental(): Promise<void> {
    if (this.running) {
      this.log.warn('skipping hourly sync — previous run still in progress');
      return;
    }
    this.running = true;
    try {
      const summaries = await this.sync.runIncremental();
      const failed = summaries.filter((s) => s.status === 'failed');
      if (failed.length) {
        this.log.error(
          `hourly sync had failures: ${failed.map((f) => f.endpoint).join(', ')}`,
        );
      }
      await this.projectIfDeadlineNear();
    } finally {
      this.running = false;
    }
  }

  /**
   * Public and separately callable so a test can exercise the window rule without a sync, and so a
   * projection failure is its own log line rather than a failed sync.
   */
  async projectIfDeadlineNear(now = new Date()): Promise<boolean> {
    const next = await this.repo.nextDeadline(now);
    if (!next) return false;
    const hours = (next.deadlineTime.getTime() - now.getTime()) / 3_600_000;
    if (hours > SNAPSHOT_WINDOW_HOURS || hours < 0) return false;
    try {
      const summary = await this.projections.run();
      this.log.log(
        `pre-deadline projections refreshed: ${summary.rowsWritten} rows, ` +
          `GW${next.gameweekId} in ${hours.toFixed(1)}h`,
      );
      return true;
    } catch (err) {
      // Projection failure must not read as a sync failure, and must be LOUD: a quiet miss here is
      // a gameweek the prospective comparison never sees.
      this.log.error(
        `pre-deadline projection FAILED with GW${next.gameweekId} ${hours.toFixed(1)}h away: ` +
          `${err instanceof Error ? err.message : err}`,
      );
      return false;
    }
  }
}
