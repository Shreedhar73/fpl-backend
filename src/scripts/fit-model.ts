/**
 * CLI for `pnpm fit:model`: fit the projection model's constants to the training seasons and print a
 * ready-to-paste replacement for `FITTED_PARAMS` in `src/modules/projections/fitted.ts`.
 *
 * It prints rather than writes, deliberately. A fitted constant has to be reviewable in a diff — the
 * same reasoning that keeps the reconstructed scoring tables in code — and a script that rewrites its
 * own source can change the model in a commit nobody reads.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import {
  CalibrationService,
  TRAIN_SEASONS,
  TEST_SEASON,
  DEFCON_FIT_MAX_ROUND,
} from '../modules/calibration/calibration.service';
import { UNFITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('fit-model');
  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(CalibrationService).fit();

    log.log('measured directly from training rows:');
    for (const [k, v] of Object.entries(report.measured)) {
      if (typeof v === 'number') {
        log.log(`  ${k.padEnd(24)} ${v.toFixed(4)}`);
      } else {
        // the keeper block (B-021), printed with its n so a fit on ~3,400 rows reads as one
        log.log(
          `  ${k.padEnd(24)} start ${v.startIntercept.toFixed(3)}+${v.startSlope.toFixed(3)}x ` +
            `(n=${v.n.start}), sub ${v.subIntercept.toFixed(3)}+${v.subSlope.toFixed(3)}x (n=${v.n.sub})`,
        );
      }
    }

    log.log(
      'chosen by held-out search (objective: RMSE — MAE rewards under-prediction here):',
    );
    for (const s of report.searched) {
      const trail = s.candidates
        .map((c) => `${c.value}=${c.rmse.toFixed(4)}`)
        .join('  ');
      const flags = [
        s.atGridBoundary
          ? '⚠ AT GRID EDGE — true optimum is outside the search'
          : '',
        s.flat
          ? `⚠ FLAT (spread ${s.spread.toFixed(4)}) — the objective cannot tell these apart; the null candidate was taken`
          : '',
      ].filter(Boolean);
      const flag = flags.length ? `  ${flags.join('  ')}` : '';
      log.log(`  ${s.name.padEnd(30)} → ${s.chosen}   [${trail}]${flag}`);
    }

    log.log('positional shrinkage targets (measured):');
    for (const [pos, rates] of Object.entries(report.leagueRates)) {
      const parts = Object.entries(rates)
        .map(([k, v]) => `${k}=${v.toFixed(3)}`)
        .join(' ');
      log.log(`  ${pos}  ${parts}`);
    }

    const withProvenance = {
      ...report.params,
      provenance: {
        fittedOn: TRAIN_SEASONS,
        rows: 0,
        date: process.env.FIT_DATE ?? 'set FIT_DATE when pasting',
        objective:
          'frequencies measured directly; shape parameters by MAE on held-out 2024-25 rounds 20+',
        heldOut: `${TEST_SEASON} (whole season), live 2026/27 (untouched)`,
        notes: [
          `defensive contribution is fitted on ${TEST_SEASON} rounds 1-${DEFCON_FIT_MAX_ROUND} — the category exists in no earlier season, so that term alone is not held out`,
          'the availability multiplier is NOT fitted: the archive carries no per-gameweek status or chance_of_playing (B-007 Phase 2 must accumulate first)',
        ],
      },
    };

    log.log('paste into src/modules/projections/fitted.ts as FITTED_PARAMS:');

    console.log(JSON.stringify(withProvenance, null, 2));

    log.log(
      `unfitted baseline for comparison: ${JSON.stringify(UNFITTED_PARAMS.minutes)}`,
    );

    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).stack ?? (err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
