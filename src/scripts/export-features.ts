/**
 * `pnpm export:features` — write the v4 training matrix (B-034).
 *
 * One CSV per position under `reports/datasets/` (gitignored), plus a committed manifest naming the
 * row counts, the column list and the span, so the artefact the Python fit consumed is identifiable
 * from git even though the CSVs themselves are not committed.
 */
import 'dotenv/config';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CalibrationRepository } from '../modules/calibration/calibration.repository';
import {
  TEST_SEASON,
  TRAIN_SEASONS,
} from '../modules/calibration/calibration.service';
import { DecisionService } from '../modules/calibration/decision.service';
import {
  exportFeatures,
  featureNames,
  toCsv,
} from '../modules/calibration/feature-export';
import { FITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('export-features');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const repo = app.get(CalibrationRepository);
    // `--all-seasons` widens the export to everything the archive holds, with imputed start labels
    // so the older rows carry a usable start history (plan 027 task 7). Without both, those seasons
    // export a `laggedStartRate` computed from no recorded starts at all.
    const wide = process.argv.includes('--all-seasons');
    const seasons = wide
      ? await repo.archiveSeasons()
      : [...TRAIN_SEASONS, TEST_SEASON];
    const rows = await repo.history(seasons);
    const scoringFor = await app.get(DecisionService).scoringResolver(seasons);
    const exported = exportFeatures(
      rows,
      FITTED_PARAMS,
      scoringFor,
      () => true,
      wide,
    );

    const dir = join(process.cwd(), 'reports', 'datasets');
    await mkdir(dir, { recursive: true });

    const positions = [...new Set(exported.map((r) => r.position))].sort();
    const counts: Record<string, number> = {};
    for (const pos of positions) {
      const subset = exported.filter((r) => r.position === pos);
      counts[pos] = subset.length;
      await writeFile(join(dir, `v4-${pos}.csv`), toCsv(subset), 'utf8');
      log.log(`v4-${pos}.csv: ${subset.length} rows`);
    }

    const bySeason: Record<string, number> = {};
    for (const r of exported)
      bySeason[r.season] = (bySeason[r.season] ?? 0) + 1;

    const manifest = {
      generated: new Date().toISOString(),
      seasons: bySeason,
      positions: counts,
      totalRows: exported.length,
      columns: featureNames().length,
      featureNames: featureNames(),
      note:
        'One row per player per FIXTURE (a double gameweek is two rows). Emitted through ' +
        'walkRounds — the same time cut every calibration number uses. Empty cells are missing ' +
        'history, not zeros; the training side must read them as NaN. Split discipline is the ' +
        "fit script's job, not this file's: TRAIN " +
        TRAIN_SEASONS.join('+') +
        ' (2024-25 rounds >= 20 reserved for validation), TEST ' +
        TEST_SEASON +
        ' — never fitted, never tuned on.',
    };
    await writeFile(
      join(dir, 'manifest.json'),
      JSON.stringify(manifest, null, 2) + '\n',
      'utf8',
    );
    log.log(
      `manifest: ${exported.length} rows, ${featureNames().length} features, seasons ${Object.keys(bySeason).join(', ')}`,
    );
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  new Logger('export-features').error(
    err instanceof Error ? err.stack : String(err),
  );
  process.exit(1);
});
