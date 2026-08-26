/**
 * CLI entry point for `pnpm sync:fpl` (see the sync-fpl skill). Boots a standalone Nest context
 * (no HTTP server), runs the chosen mode, prints what changed, and exits with a non-zero code if
 * any endpoint failed — so a scheduled or scripted run can tell success from failure.
 *
 *   pnpm sync:fpl              # incremental: bootstrap-static + fixtures
 *   pnpm sync:fpl -- --full    # + per-player history backfill (hundreds of requests, minutes)
 *   pnpm sync:fpl -- --live    # not implemented in this pass (B-003 follow-up)
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { SyncService, SyncRunSummary } from '../modules/fpl-sync/sync.service';

async function main(): Promise<void> {
  const log = new Logger('sync');
  const args = process.argv.slice(2);
  const mode = args.includes('--full') ? 'full' : args.includes('--live') ? 'live' : 'incremental';

  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error', 'warn', 'log'] });
  try {
    const sync = app.get(SyncService);
    let summaries: SyncRunSummary[];
    if (mode === 'full') {
      summaries = await sync.runFull();
    } else if (mode === 'live') {
      const gw = Number(args[args.indexOf('--live') + 1]);
      summaries = [await sync.runLive(gw)]; // rejects with a clear message in this pass
    } else {
      summaries = await sync.runIncremental();
    }

    for (const s of summaries) {
      const line = `${s.endpoint.padEnd(24)} ${s.status.padEnd(8)} ${s.rowsWritten} rows`;
      if (s.status === 'failed') log.error(`${line}${s.error ? ` — ${s.error}` : ''}`);
      else log.log(line);
    }

    const failed = summaries.some((s) => s.status === 'failed');
    await app.close();
    process.exit(failed ? 1 : 0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
