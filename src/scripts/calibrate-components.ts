/**
 * CLI for `pnpm calibrate:components` — B-013.
 *
 * Scores the model's internal probabilities and component means against realised archive outcomes,
 * per component and per position, and writes `reports/calibration-components.md`.
 *
 * `pnpm calibrate:components unfitted` scores v1's guesses restated in the v2 shape, on identical
 * rows — the comparison that says whether the fit changed the SHAPE of a term or only its level.
 *
 * `pnpm calibrate:components shape028` scores the incumbent with plan 028's model-shape changes
 * switched on — per-player starter minutes and the rank-based bonus. Those two terms are capped at a
 * couple of points each and can be structurally fixed without moving points-captured@11 at all, so
 * the reliability curve is where they have to be read (plan 028 rule 2). The temperature is the one
 * the 2025-26 fold chose on its validation season; nothing here selects.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ComponentCalibrationService } from '../modules/calibration/component-calibration.service';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../modules/projections/fitted';

/** The temperature the 2025-26 fold chose on its own validation season. Not selected here. */
const SHAPE_028_BONUS_TAU = 16;

async function main(): Promise<void> {
  const log = new Logger('calibrate:components');
  const arg = process.argv[2];
  const which =
    arg === 'unfitted'
      ? 'unfitted'
      : arg === 'shape028'
        ? 'shape028'
        : 'fitted';
  const params =
    which === 'unfitted'
      ? UNFITTED_PARAMS
      : which === 'shape028'
        ? {
            ...FITTED_PARAMS,
            minutes: { ...FITTED_PARAMS.minutes, perPlayerStart: true },
            bonus: { ...FITTED_PARAMS.bonus, tau: SHAPE_028_BONUS_TAU },
          }
        : FITTED_PARAMS;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app
      .get(ComponentCalibrationService)
      .evaluate(which, params);
    log.log(`report: ${r.path} (${r.rows.toLocaleString()} rows)`);
    for (const b of r.binaries) {
      log.log(
        `${b.label.padEnd(38)} n=${String(b.overall.n).padStart(6)} ` +
          `base=${b.overall.baseRate.toFixed(3)} pred=${b.overall.meanPredicted.toFixed(3)} ` +
          `reliability=${b.overall.reliability.toFixed(4)} skill=${b.overall.skillScore.toFixed(3)}`,
      );
    }
    log.log(`verdict: ${r.verdict}`);
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
