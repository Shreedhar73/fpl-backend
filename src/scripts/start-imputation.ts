/**
 * CLI for `pnpm report:imputation` — write `reports/start-imputation.md` (B-040, plan 027 task 6).
 *
 * What the imputed start labels are worth, measured three ways: leave-one-season-out accuracy and
 * Brier against the seasons that record the truth, the calibration table itself, and the gate that
 * does not depend on the era the table was fitted in — 22 starters per fixture, per season.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { AppModule } from '../app.module';
import { CalibrationRepository } from '../modules/calibration/calibration.repository';
import {
  calibrateStarts,
  summariseImputation,
  validateImputation,
} from '../modules/archive/start-imputation';

async function main(): Promise<void> {
  const log = new Logger('start-imputation');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const repo = app.get(CalibrationRepository);
    // `history` already attaches the probabilities, so this report measures exactly what the fits
    // would see — not a second implementation of the same idea.
    const rows = await repo.history(await repo.archiveSeasons());
    const calibration = calibrateStarts(rows);
    const validation = validateImputation(rows);
    const perSeason = summariseImputation(rows);

    const lines: string[] = [];
    lines.push('# Imputed start labels');
    lines.push('');
    lines.push(
      `Generated ${new Date().toISOString()} from ${rows.length.toLocaleString()} archive rows. ` +
        'Regenerate with `pnpm report:imputation`.',
    );
    lines.push('');
    lines.push(
      '`starts` exists in the archive only from 2023-24, and every part of the minutes model is a ' +
        'regression on it — so seven of ten seasons contribute nothing to the half of the model the ' +
        'guide calls the real one. The rolling-origin referee measured the cost exactly: 2 of 9 folds ' +
        'ran. Minutes are recorded in all ten seasons and are very nearly a start label already, so ' +
        'the label is inferred from them — as a **probability**, because one band is genuinely ' +
        'ambiguous and a hard label there would hand the fit the wrong answer with no way to know which.',
    );
    lines.push('');
    lines.push(
      `## The calibration, fitted on ${calibration.seasons.join(', ')}`,
    );
    lines.push('');
    lines.push('| minutes ≥ | rows | started | P(start) |');
    lines.push('|---:|---:|---:|---:|');
    for (const band of [...calibration.bands.values()].sort(
      (a, b) => b.band - a.band,
    )) {
      lines.push(
        `| ${band.band} | ${band.rows.toLocaleString()} | ${band.started.toLocaleString()} | ` +
          `${band.probability.toFixed(4)} |`,
      );
    }
    lines.push('');
    lines.push(
      'A player still on the pitch at 90 minutes started, every time. The ambiguity is one band — ' +
        '45 to 59 minutes, where an early-substituted starter and a half-time substitute are the ' +
        'same row.',
    );
    lines.push('');
    lines.push('## Scored against the seasons that record the truth');
    lines.push('');
    lines.push(
      'Leave-one-season-out: each season is scored by a calibration fitted without it. The hard ' +
        'label is `p ≥ 0.5` and exists only so accuracy is readable; what the fit actually consumes ' +
        'is the probability, which is what the Brier column is about.',
    );
    lines.push('');
    lines.push(
      '| season | rows | accuracy | Brier | imputed starters / fixture |',
    );
    lines.push('|---|---:|---:|---:|---:|');
    for (const v of validation) {
      lines.push(
        `| ${v.season} | ${v.rows.toLocaleString()} | ${(100 * v.accuracy).toFixed(2)}% | ` +
          `${v.brier.toFixed(4)} | ${v.startersPerFixture.toFixed(2)} |`,
      );
    }
    lines.push('');
    lines.push('## The gate: 22 starters per fixture');
    lines.push('');
    lines.push(
      'Eleven a side start a match, whatever the substitution rules were that year. This is the one ' +
        'check on the imputation that does not depend on the era its calibration was fitted in — ' +
        'which matters, because the table comes from the five-substitute era and is applied to the ' +
        'three-substitute one. A season that fails it is not used.',
    );
    lines.push('');
    lines.push(
      '| season | rows | imputed rows | fixtures | starters / fixture | passes |',
    );
    lines.push('|---|---:|---:|---:|---:|---|');
    for (const s of perSeason) {
      lines.push(
        `| ${s.season} | ${s.rows.toLocaleString()} | ` +
          `${s.imputedRows === 0 ? '—' : s.imputedRows.toLocaleString()} | ${s.fixtures} | ` +
          `${s.startersPerFixture.toFixed(3)} | ${s.passes ? 'yes' : '**NO**'} |`,
      );
    }
    lines.push('');
    const failed = perSeason.filter((s) => !s.passes);
    lines.push(
      failed.length === 0
        ? 'Every season comes to 22 starters per fixture inside half a starter.'
        : `**${failed.map((s) => s.season).join(', ')} fail the gate** and must not be trained on ` +
            `until the reason is understood.`,
    );
    lines.push('');

    const dir = join(process.cwd(), 'reports');
    await mkdir(dir, { recursive: true });
    const path = join(dir, 'start-imputation.md');
    await writeFile(path, lines.join('\n'), 'utf8');
    log.log(`report: ${path}`);
    for (const v of validation) {
      log.log(
        `${v.season}: accuracy ${(100 * v.accuracy).toFixed(2)}%, Brier ${v.brier.toFixed(4)}`,
      );
    }
    for (const s of perSeason) {
      log.log(
        `${s.season}: ${s.startersPerFixture.toFixed(3)} starters/fixture — ${s.passes ? 'passes' : 'FAILS'}`,
      );
    }
  } finally {
    await app.close();
  }
}

void main();
