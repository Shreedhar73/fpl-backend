/**
 * CLI for `pnpm decision-quality`: score a model on ordering and decision quality over the held-out
 * test season, and write the report.
 *
 * Separate from `pnpm calibrate` because the two answer different questions and D-020 settled which
 * one is the verdict. `calibrate` reports how far each prediction was from the outcome; this reports
 * whether the ordering those predictions imply beats the alternatives. Error metrics are diagnostics;
 * this is the bar.
 *
 * `pnpm decision-quality unfitted` scores v1's constants on identical rows, which is what makes
 * "fitting achieved something" checkable rather than assumed.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { DecisionService } from '../modules/calibration/decision.service';
import { DEFAULT_KS } from '../modules/calibration/ordering';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../modules/projections/fitted';

async function main(): Promise<void> {
  const log = new Logger('decision-quality');
  const which = process.argv[2] === 'unfitted' ? 'unfitted' : 'fitted';
  const params = which === 'unfitted' ? UNFITTED_PARAMS : FITTED_PARAMS;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const r = await app.get(DecisionService).evaluate(which, params);
    log.log(`report: ${r.path}`);
    for (const [predictor, s] of r.ordering) {
      const captured = DEFAULT_KS.map((k) => {
        const v = s.meanPointsCaptured.get(k) ?? null;
        return `@${k}=${v === null ? '—' : (v * 100).toFixed(1) + '%'}`;
      }).join(' ');
      log.log(
        `${predictor.padEnd(11)} rounds=${s.rounds} ` +
          `spearman=${s.meanSpearman === null ? '—' : s.meanSpearman.toFixed(3)} ` +
          `captured ${captured}`,
      );
    }
    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
