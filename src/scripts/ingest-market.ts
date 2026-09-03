/**
 * CLI for `pnpm ingest:market`: the deadline-time market fields — `ep_next`, `ep_this`, `form`,
 * `now_cost`, `selected_by_percent` — for past seasons, from the same Wayback captures of
 * `bootstrap-static` the availability ingest already cached (B-043, plan 029). Writes
 * `archive_deadline_market`; runs from the disk cache when it can.
 *
 * `pnpm ingest:market 2025-26` ingests one season; no argument ingests the three the cache covers.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { WaybackAvailabilityService } from '../modules/archive/wayback-availability.service';

/** The seasons the Wayback cache covers — plan 024 ingested these three and no others. */
const CACHED_SEASONS = ['2023-24', '2024-25', '2025-26'];

async function main(): Promise<void> {
  const log = new Logger('ingest-market');
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const seasons = requested.length > 0 ? requested : CACHED_SEASONS;

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const service = app.get(WaybackAvailabilityService);
    for (const season of seasons) {
      const s = await service.ingestMarket(season);
      log.log(
        `${s.season}: ${s.roundsCaptured}/38 rounds, ${s.rowsWritten} rows, ` +
          `${s.rowsWithEpNext} with ep_next, ${s.roundsMismatched} mismatched round(s)`,
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
