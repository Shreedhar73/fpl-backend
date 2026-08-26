/**
 * CLI for `pnpm calibrate`: score a model on the held-out test season and write the report.
 *
 * `pnpm calibrate` scores the fitted parameters; `pnpm calibrate unfitted` scores v1's guesses
 * restated in the v2 shape. Running both is the comparison that says whether fitting achieved
 * anything, on identical rows.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { CalibrationService } from '../modules/calibration/calibration.service';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('calibrate');
  const which = process.argv[2] === 'unfitted' ? 'unfitted' : 'fitted';
  const params = which === 'unfitted' ? UNFITTED_PARAMS : FITTED_PARAMS;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(CalibrationService).evaluate(which, params);
    log.log(`report: ${r.path}`);
    log.log(
      `model      n=${r.model.n} MAE=${r.model.mae.toFixed(3)} ` +
        `RMSE=${r.model.rmse.toFixed(3)} bias=${r.model.bias.toFixed(3)}`,
    );
    log.log(
      `form       n=${r.baselineForm.n} MAE=${r.baselineForm.mae.toFixed(3)}`,
    );
    log.log(
      `last-season n=${r.baselinePriorSeason.n} MAE=${r.baselinePriorSeason.mae.toFixed(3)}`,
    );
    log.log(
      r.beatsForm && r.beatsPriorSeason
        ? 'beats both baselines on MAE'
        : 'does NOT beat both baselines on MAE',
    );
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
