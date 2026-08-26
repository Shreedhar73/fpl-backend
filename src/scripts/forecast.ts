/**
 * CLI for `pnpm forecast`: project the upcoming gameweeks with the FITTED model and persist them, so
 * `pnpm optimize` picks a squad from measured numbers rather than from v1's guesses.
 *
 *   pnpm forecast            # the next 5 gameweeks
 *   pnpm forecast 2          # gameweek 2 only
 *
 * These are real projections on the serving path, not a backtest — the harness writes nothing, this
 * writes rows on purpose, under its own `modelVersion` so v1's rows stay for comparison.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ForecastService } from '../modules/calibration/forecast.service';
import { ProjectionsRepository } from '../modules/projections/projections.repository';
import { FITTED_PARAMS } from '../modules/projections/fitted';

/** Bumped whenever the fitted parameters change, so old projections stay comparable. */
const MODEL_VERSION = `v2-fitted-${FITTED_PARAMS.provenance.date}`;
const HORIZON = 5;

async function main(): Promise<void> {
  const log = new Logger('forecast');
  const only = process.argv.slice(2).find((a) => /^\d+$/.test(a));

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const forecast = app.get(ForecastService);
    const projections = app.get(ProjectionsRepository);

    const gwIds = only
      ? [Number(only)]
      : await projections.horizonGameweeks(HORIZON);
    if (gwIds.length === 0) throw new Error('no upcoming gameweeks to project');

    const results = await forecast.forecastMany(gwIds);

    let written = 0;
    for (const { summary, players } of results) {
      const rows = players
        .filter((p) => p.playerId !== null)
        .map((p) => ({
          playerId: p.playerId!,
          gameweekId: summary.gameweekId,
          modelVersion: MODEL_VERSION,
          expectedPoints: round(p.expectedPoints, 2),
          expectedMinutes: round(p.expectedMinutes, 2),
          playProbability: round(p.playProbability, 3),
          components: {
            ...Object.fromEntries(
              Object.entries(p.components).map(([k, v]) => [k, round(v, 3)]),
            ),
            fixtures: p.fixtures,
          },
        }));
      written += await projections.writeProjections(rows);
    }

    log.log(`${MODEL_VERSION}: ${written} projection rows across GW${gwIds.join(', GW')}`);

    const next = results[0];
    log.log(
      `GW${next.summary.gameweekId} — ${next.summary.players} players, ` +
        `${next.summary.fromSnapshot} on a captured deadline snapshot, ` +
        `${next.summary.withoutHistory} with no prior history`,
    );
    log.log('top expected points:');
    for (const p of next.players.slice(0, 15)) {
      log.log(
        `  ${p.webName.padEnd(18)} ${p.position} £${(p.nowCost / 10).toFixed(1)}m  ` +
          `${p.expectedPoints.toFixed(2).padStart(5)} pts  ` +
          `${p.expectedMinutes.toFixed(0).padStart(3)} min  ` +
          `${p.fixtures} fx`,
      );
    }

    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).stack ?? (err as Error).message);
    await app.close();
    process.exit(1);
  }
}

function round(x: number, dp: number): number {
  const f = 10 ** dp;
  return Math.round(x * f) / f;
}

void main();
