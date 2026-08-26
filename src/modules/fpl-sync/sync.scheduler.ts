import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SyncService } from './sync.service';

/**
 * Keeps the public dataset current. Hourly incremental only — `--live` and `--full` stay manual
 * (they are heavy or need a live gameweek), invoked via `pnpm sync:fpl` from the sync-fpl skill.
 *
 * The tightened pre-deadline poll (every 5 min in the 2 h before a deadline) is a deliberate
 * follow-up, not wired here — see docs/plans/003-fpl-sync.md.
 *
 * A locked run guards against overlap if a sync ever runs long enough to meet the next tick.
 */
@Injectable()
export class SyncScheduler {
  private readonly log = new Logger(SyncScheduler.name);
  private running = false;

  constructor(private readonly sync: SyncService) {}

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
    } finally {
      this.running = false;
    }
  }
}
