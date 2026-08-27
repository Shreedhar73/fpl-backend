/**
 * `pnpm measure:collision` — what a fixture collision actually does (B-028).
 *
 * B-011 has been argued three times and measured once, and the one measurement asked whether the
 * penalty earns points rather than what the penalty is about. This walks three archived seasons and
 * reports the realised covariance of every (our attacker, their defensive player) pair, what a
 * defender is actually paid for by season, and whether the 2025/26 defensive-contribution category
 * changed the mechanism.
 *
 * Reads only. Writes `reports/collision-correlation.md`.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CollisionCorrelationService } from '../modules/calibration/collision-correlation.service';
import { TEST_SEASON, TRAIN_SEASONS } from '../modules/calibration/calibration.service';

async function main(): Promise<void> {
  const log = new Logger('collision');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const path = await app
      .get(CollisionCorrelationService)
      .measure([...TRAIN_SEASONS, TEST_SEASON]);
    log.log(`wrote ${path}`);
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('collision').error(err instanceof Error ? err.stack : String(err));
  process.exit(1);
});
