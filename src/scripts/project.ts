/**
 * CLI for `pnpm project`: compute and persist projections for the upcoming gameweeks, then print the
 * top expected-points players with `ep_next` (FPL's own number) alongside, and the MAE against it —
 * the baseline the model has to beat (`fpl-optimizer` honesty rules).
 *
 * Compiled-run pattern, like `sync:fpl` (the Prisma 7 client uses ESM specifiers ts-node CJS cannot
 * resolve). Reads Postgres only; no FPL calls.
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
    const summary = await app.get(ProjectionsService).run();
    log.log(
      `projected ${summary.playersProjected} players over gameweeks ` +
        `${summary.gameweekIds.join(', ')} — ${summary.rowsWritten} rows written`,
    );
    if (summary.baselineMaeVsEpNext !== null) {
      log.log(`next-GW baseline: MAE vs ep_next = ${summary.baselineMaeVsEpNext}`);
    }
    log.log(`top expected points for GW${summary.nextGameweek} (ours | ep_next | horizon):`);
    for (const t of summary.top) {
      log.log(
        `  ${t.webName.padEnd(18)} ${t.nextGwEp.toFixed(2).padStart(6)} | ` +
          `${(t.epNext ?? 0).toFixed(2).padStart(6)} | ${t.horizonEp.toFixed(2).padStart(6)}`,
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
