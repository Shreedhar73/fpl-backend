/**
 * CLI for `pnpm import:archive`: pull the last three completed seasons of per-gameweek history from
 * the community archive into `archive_player_gameweek` (B-007 Phase 2b).
 *
 * Compiled-run pattern, like `sync:fpl` and `project`. Network + Postgres; safe to re-run — each
 * season is replaced wholesale, so a re-import after an archive update converges.
 *
 * `pnpm import:archive 2025-26` imports one season.
 */
import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { AppModule } from '../app.module';
import { ArchiveService } from '../modules/archive/archive.service';
import { ARCHIVE_SEASONS } from '../modules/archive/archive.mappers';

async function main(): Promise<void> {
  const log = new Logger('import-archive');
  const requested = process.argv.slice(2).filter((a) => !a.startsWith('-'));
  const seasons = requested.length > 0 ? requested : [...ARCHIVE_SEASONS];

  const app = await NestFactory.createApplicationContext(AppModule, {
    logger: ['error', 'warn', 'log'],
  });
  try {
    const summaries = await app.get(ArchiveService).importAll(seasons);

    log.log('season    rows    resolved  linked  defcon-checked  points-verified');
    for (const s of summaries) {
      log.log(
        `${s.season}  ${String(s.imported).padStart(6)}  ` +
          `${(s.resolveRate * 100).toFixed(2).padStart(7)}%  ` +
          `${(s.linkRate * 100).toFixed(1).padStart(5)}%  ` +
          `${String(s.defconRowsChecked).padStart(11)}  ` +
          `${String(s.pointsVerified).padStart(13)}`,
      );
    }
    const unverified = summaries.filter((s) => s.pointsVerified === 0);
    if (unverified.length > 0) {
      log.warn(
        `not points-verified (no reconstructed scoring table): ` +
          unverified.map((s) => s.season).join(', '),
      );
    }
    const total = summaries.reduce((n, s) => n + s.imported, 0);
    log.log(`${total} player-gameweeks held across ${summaries.length} seasons`);

    await app.close();
    process.exit(0);
  } catch (err) {
    log.error((err as Error).message);
    await app.close();
    process.exit(1);
  }
}

void main();
