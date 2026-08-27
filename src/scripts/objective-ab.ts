/**
 * `pnpm ab:objective` — walk an archived season under each squad objective this project has solved,
 * paired by round (B-031).
 *
 * Unlike `pnpm replay:xi`, the arms are NOT run parameters resolved at different commits: every arm
 * is emitted by the same build, so nothing here can silently overwrite a baseline with the thing it
 * is the baseline for. The objective is a value, not a checkout.
 *
 * Nothing is persisted; the service asserts the projection and optimizer-run counts unmoved.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ObjectiveAbService } from '../modules/calibration/objective-ab.service';
import { FITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('objective-ab');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(ObjectiveAbService).run(FITTED_PARAMS);
    for (const s of report.seasons) {
      log.log(
        `${s.policy.padEnd(12)} ${s.arm.padEnd(34)} ${s.result.totalPoints} points`,
      );
    }
    log.log(`wrote ${report.path}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('objective-ab').error(
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
