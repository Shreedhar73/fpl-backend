/**
 * CLI for `pnpm score:gameweek` — B-016.
 *
 * Scores the projections this project actually SERVED against what happened, alongside FPL's own
 * `ep_next` and `form` as captured in the pre-deadline snapshot. Writes
 * `reports/served-projections.md`.
 *
 * `pnpm score:gameweek 2` scores one gameweek and reports why it could not, if it could not. With no
 * argument it walks every gameweek that has a projection.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ServedScoringService } from '../modules/calibration/served-scoring.service';

async function main(): Promise<void> {
  const log = new Logger('score:gameweek');
  const arg = process.argv[2];
  const only = arg === undefined ? undefined : Number(arg);
  if (only !== undefined && !Number.isInteger(only)) {
    log.error(`"${arg}" is not a gameweek number`);
    process.exit(1);
  }

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const report = await app.get(ServedScoringService).score(only);
    log.log(`report: ${report.path}`);
    for (const gw of report.scored) {
      log.log(`GW${gw.gameweekId}: ${gw.players} players`);
      for (const c of gw.comparisons) {
        log.log(
          `  ${c.label.padEnd(24)} n=${String(c.n).padStart(4)} ` +
            `MAE=${c.stats.mae.toFixed(3)} RMSE=${c.stats.rmse.toFixed(3)} bias=${c.stats.bias.toFixed(3)}`,
        );
      }
    }
    for (const s of report.skipped) {
      log.warn(`GW${s.gameweekId} not scored: ${s.reason}`);
    }
    if (report.scored.length === 0) {
      log.warn(
        'nothing scored — no gameweek has both a served projection and checked data. That is a ' +
          'state, not a failure, and the report says so.',
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
