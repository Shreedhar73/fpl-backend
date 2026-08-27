/**
 * CLI for `pnpm report:availability`: plan 024's one TEST reading — the incumbent (hand multiplier
 * over historical flags) against the availability candidate (the joint refit), paired over the
 * held-out season, banded so a win made of trivial rows cannot carry the verdict.
 *
 * Writes `reports/availability-fit.md`. Read-only against the database; writes no projection.
 */
import 'dotenv/config';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import {
  CalibrationService,
  TRAIN_SEASONS,
  TEST_SEASON,
} from '../modules/calibration/calibration.service';
import { CalibrationRepository } from '../modules/calibration/calibration.repository';
import { availabilityReport } from '../modules/calibration/availability-report';
import {
  AVAILABILITY_CANDIDATE_PARAMS,
  FITTED_PARAMS,
} from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('availability-report');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const repo = app.get(CalibrationRepository);
    const scoringFor = await app.get(CalibrationService).scoringResolver();
    const rows = await repo.history([...TRAIN_SEASONS, TEST_SEASON]);

    const verdict = availabilityReport(
      rows,
      TEST_SEASON,
      FITTED_PARAMS,
      AVAILABILITY_CANDIDATE_PARAMS,
      scoringFor,
    );

    const path = join(process.cwd(), 'reports', 'availability-fit.md');
    await writeFile(path, verdict.report);
    log.log(`report: ${path}`);
    log.log(`bar (all legs): ${verdict.decisiveLegMet ? 'MET' : 'NOT MET'}`);

    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
