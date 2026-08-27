/**
 * CLI for `pnpm calibrate:components` — B-013.
 *
 * Scores the model's internal probabilities and component means against realised archive outcomes,
 * per component and per position, and writes `reports/calibration-components.md`.
 *
 * `pnpm calibrate:components unfitted` scores v1's guesses restated in the v2 shape, on identical
 * rows — the comparison that says whether the fit changed the SHAPE of a term or only its level.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ComponentCalibrationService } from '../modules/calibration/component-calibration.service';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('calibrate:components');
  const which = process.argv[2] === 'unfitted' ? 'unfitted' : 'fitted';
  const params = which === 'unfitted' ? UNFITTED_PARAMS : FITTED_PARAMS;

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
