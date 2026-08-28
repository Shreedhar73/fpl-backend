/**
 * CLI for `pnpm report:coverage` — write `reports/archive-coverage.md` (B-040, plan 027 task 3).
 *
 * What the archive holds, per season and per column, measured rather than remembered. The same
 * measurement `CalibrationRepository.history` asserts on every read; this writes it down so a plan
 * can be argued from it without opening a psql session.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { CalibrationRepository } from '../modules/calibration/calibration.repository';
import { coverageOf, renderCoverage } from '../modules/archive/coverage';

async function main(): Promise<void> {
  const log = new Logger('archive-coverage');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const repo = app.get(CalibrationRepository);
    // `history` asserts the shape as it reads, so a coverage report can never disagree with the
    // check that governs the fits — if the archive is broken this throws before writing anything.
    const rows = await repo.history(await repo.archiveSeasons());
    const coverage = coverageOf(rows);
    const dir = join(process.cwd(), 'reports');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'archive-coverage.md');
    await writeFile(
      path,
      renderCoverage(coverage, new Date().toISOString()),
      'utf8',
    );
    log.log(`report: ${path}`);
    for (const s of coverage) {
      log.log(
        `${s.season}: ${s.rows} rows, ${s.roundsPresent} rounds, ` +
          `starts ${s.columns.starts}, xG ${s.columns.expectedGoals}, ` +
          `defcon ${s.columns.defensiveContribution}`,
      );
    }
  } finally {
    await app.close();
  }
}

void main();
