/**
 * CLI for `pnpm project`: compute and persist projections for the upcoming gameweeks, then print the
 * top expected-points players.
 *
 * This is the ONLY thing that writes projections. It used to run a v1 heuristic while a separate
 * `pnpm forecast` wrote the fitted model, and serving picks by `createdAt desc` — so whichever ran
 * last silently became the model the whole app served. `pnpm forecast` is gone and this runs the
 * fitted path (B-007 Phase 4e).
 *
 * Compiled-run pattern, like `sync:fpl` (the Prisma 7 client uses ESM specifiers ts-node CJS cannot
 * resolve). Reads Postgres and the archive; no FPL calls.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ProjectionsService } from '../modules/projections/projections.service';

async function main(): Promise<void> {
  const log = new Logger('project');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const s = await app.get(ProjectionsService).run();

    log.log(
      `${s.modelVersion}: ${s.rowsWritten} rows for ${s.playersProjected} players over ` +
        `GW${s.gameweekIds.join(', GW')}`,
    );
    log.log(
      `GW${s.nextGameweek}: ${s.fromSnapshot} players priced off a captured deadline snapshot, ` +
        `${s.withoutHistory} with no prior history`,
    );
    if (s.fromSnapshot === 0) {
      log.warn(
        `no deadline snapshot for GW${s.nextGameweek} — availability came from the live players row, ` +
          `which is overwritten as news changes. Run \`pnpm sync:fpl\` inside 36h of the deadline ` +
          `(or with --snapshot) so this gameweek is recorded before it happens.`,
      );
    }

    log.log('top expected points (next GW | 5-GW horizon):');
    for (const t of s.top) {
      log.log(
        `  ${t.webName.padEnd(18)} ${t.position} £${(t.nowCost / 10).toFixed(1).padStart(5)}m  ` +
          `${t.nextGwEp.toFixed(2).padStart(6)} | ${t.horizonEp.toFixed(2).padStart(6)}`,
      );
    }

    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
