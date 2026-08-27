import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { gunzipSync } from 'node:zlib';
import { Prisma } from '../../generated/prisma/client';
import { PrismaService } from '../../infra/prisma/prisma.service';
import { ArchiveSeason } from './archive.mappers';

/**
 * Recovers deadline-time availability (`status`, `chance_of_playing_next_round`) for PAST seasons
 * from Wayback Machine captures of `bootstrap-static` (B-015, plan 024).
 *
 * Why this exists: the community archive carries no per-gameweek `status` (D-016), and our own
 * `PlayerDeadlineSnapshot` only started at 2026-27 GW2 — so the availability half of the minutes
 * model had nothing historical to fit against. The Wayback Machine turns out to hold near-daily
 * captures of the whole bootstrap payload (probed 2026-08-27), which carries every player's flags.
 *
 * The one leak this table must never contain: a capture taken AFTER a deadline encodes what the
 * matches revealed — by then `status` says who got injured DURING the round. So each round takes the
 * LAST capture strictly BEFORE its deadline, the deadline itself read from a season-END capture,
 * where `events[].deadline_time` is historical fact rather than a schedule that later moved.
 * `snapshotAt < deadlineAt` is asserted here and re-asserted by the fit.
 */

/** Wayback etiquette: sequential fetches with a pause; we are a guest twice over here. */
const FETCH_PAUSE_MS = 500;
const CDX_BASE = 'https://web.archive.org/cdx/search/cdx';
const SNAPSHOT_TARGET = 'https://fantasy.premierleague.com/api/bootstrap-static/';
/** Machine-local cache, sibling of the vaastav cache. A capture is immutable — cache forever. */
const CACHE_DIR = join('.archive-cache', 'wayback');

export interface RoundCoverage {
  season: string;
  round: number;
  deadlineAt: Date;
  /** null when no capture exists before the deadline (within the season window) */
  snapshotAt: Date | null;
  gapHours: number | null;
  players: number;
  /** players whose status was not 'a' at the capture */
  flagged: number;
  /** the uncertain band the fit is judged on: status 'd', or a 25/50/75 chance */
  doubtful: number;
}

export interface SeasonIngestSummary {
  season: string;
  rounds: number;
  roundsCaptured: number;
  roundsMissing: number[];
  rowsWritten: number;
  maxGapHours: number;
  coverage: RoundCoverage[];
}

interface BootstrapElement {
  code: number;
  element_type: number;
  status: string;
  chance_of_playing_next_round: number | null;
  news: string;
}

interface BootstrapEvent {
  id: number;
  deadline_time: string;
  finished: boolean;
}

interface BootstrapPayload {
  events: BootstrapEvent[];
  elements: BootstrapElement[];
}

/** "2023-24" → [Date(2023-07-01), Date(2024-06-30)] — the window one season's captures live in. */
function seasonWindow(season: string): { from: string; to: string } {
  const startYear = Number(season.slice(0, 4));
  return { from: `${startYear}0701`, to: `${startYear + 1}0630` };
}

/** Wayback 14-digit timestamp (UTC) → Date. */
export function timestampToDate(ts: string): Date {
  return new Date(
    Date.UTC(
      Number(ts.slice(0, 4)),
      Number(ts.slice(4, 6)) - 1,
      Number(ts.slice(6, 8)),
      Number(ts.slice(8, 10)),
      Number(ts.slice(10, 12)),
      Number(ts.slice(12, 14)),
    ),
  );
}

/**
 * The one selection rule the leak guard is about: the LAST capture STRICTLY before the deadline.
 * A capture at or after the deadline second encodes what the matches revealed — never eligible.
 * Null when nothing precedes the deadline. Pure, so the test can break it on purpose.
 */
export function lastCaptureBefore(
  timestamps: string[],
  deadline: Date,
): string | null {
  const before = timestamps.filter((ts) => timestampToDate(ts) < deadline);
  return before.length > 0 ? before[before.length - 1] : null;
}

@Injectable()
export class WaybackAvailabilityService {
  private readonly log = new Logger(WaybackAvailabilityService.name);
  private lastFetchAt = 0;

  constructor(private readonly prisma: PrismaService) {}

  async ingestAll(seasons: string[]): Promise<SeasonIngestSummary[]> {
    const summaries: SeasonIngestSummary[] = [];
    for (const season of seasons) {
      summaries.push(await this.ingestSeason(season));
    }
    return summaries;
  }

  async ingestSeason(season: ArchiveSeason | string): Promise<SeasonIngestSummary> {
    const timestamps = await this.captureTimestamps(season);
    if (timestamps.length === 0) {
      throw new Error(`${season}: the Wayback CDX index lists no captures at all`);
    }

    // Deadlines from the season-END capture: by June the season's deadlines are history, not plan.
    const endPayload = await this.fetchSnapshot(timestamps[timestamps.length - 1]);
    const events = endPayload.events;
    if (events.length !== 38) {
      throw new Error(`${season}: season-end capture lists ${events.length} events, not 38`);
    }
    const unfinished = events.filter((e) => !e.finished);
    if (unfinished.length > 0) {
      throw new Error(
        `${season}: season-end capture has unfinished events (${unfinished
          .map((e) => e.id)
          .join(', ')}) — its deadlines are still a schedule, not a record`,
      );
    }

    const coverage: RoundCoverage[] = [];
    const rows: Prisma.ArchiveAvailabilitySnapshotCreateManyInput[] = [];

    for (const event of events) {
      const deadlineAt = new Date(event.deadline_time);
      const ts = lastCaptureBefore(timestamps, deadlineAt);
      if (ts === null) {
        coverage.push({
          season,
          round: event.id,
          deadlineAt,
          snapshotAt: null,
          gapHours: null,
          players: 0,
          flagged: 0,
          doubtful: 0,
        });
        continue;
      }
      const snapshotAt = timestampToDate(ts);
      if (snapshotAt >= deadlineAt) {
        throw new Error(`${season} GW${event.id}: capture ${ts} is not before the deadline`);
      }
      const gapHours = (deadlineAt.getTime() - snapshotAt.getTime()) / 3_600_000;
      const payload = await this.fetchSnapshot(ts);

      // element_type 5 is the Assistant Manager element FPL ran in 2024-25 — not a player
      const players = payload.elements.filter((e) => e.element_type >= 1 && e.element_type <= 4);
      let flagged = 0;
      let doubtful = 0;
      for (const p of players) {
        if (p.status !== 'a') flagged += 1;
        const c = p.chance_of_playing_next_round;
        if (p.status === 'd' || c === 25 || c === 50 || c === 75) doubtful += 1;
        rows.push({
          season,
          round: event.id,
          playerCode: p.code,
          status: p.status,
          chanceOfPlayingNextRound: c,
          news: p.news === '' ? null : p.news,
          snapshotAt,
          deadlineAt,
          gapHours: new Prisma.Decimal(gapHours.toFixed(2)),
        });
      }
      coverage.push({
        season,
        round: event.id,
        deadlineAt,
        snapshotAt,
        gapHours,
        players: players.length,
        flagged,
        doubtful,
      });
    }

    const written = await this.replaceSeason(season, rows);
    const captured = coverage.filter((c) => c.snapshotAt !== null);
    const summary: SeasonIngestSummary = {
      season,
      rounds: coverage.length,
      roundsCaptured: captured.length,
      roundsMissing: coverage.filter((c) => c.snapshotAt === null).map((c) => c.round),
      rowsWritten: written,
      maxGapHours: Math.max(...captured.map((c) => c.gapHours ?? 0)),
      coverage,
    };
    this.log.log(
      `${season}: ${summary.roundsCaptured}/${summary.rounds} rounds captured, ` +
        `${written} rows, max gap ${summary.maxGapHours.toFixed(1)}h`,
    );
    return summary;
  }

  /** All 200-status capture timestamps for one season's window, ascending. One CDX call. */
  private async captureTimestamps(season: string): Promise<string[]> {
    const { from, to } = seasonWindow(season);
    const url =
      `${CDX_BASE}?url=${encodeURIComponent('fantasy.premierleague.com/api/bootstrap-static/')}` +
      `&from=${from}&to=${to}&output=json&fl=timestamp,statuscode&filter=statuscode:200`;
    const body = await this.politeFetch(url, `cdx-${season}.json`);
    const parsed = JSON.parse(body.toString('utf8')) as string[][];
    // first row is the header
    const stamps = parsed
      .slice(1)
      .map((r) => r[0])
      .filter((ts) => /^\d{14}$/.test(ts));
    return [...new Set(stamps)].sort();
  }

  /** One capture's payload, via the `id_` raw form. Cached on disk keyed by timestamp. */
  private async fetchSnapshot(ts: string): Promise<BootstrapPayload> {
    const body = await this.politeFetch(
      `https://web.archive.org/web/${ts}id_/${SNAPSHOT_TARGET}`,
      `bs-${ts}.json`,
    );
    // The id_ form serves the original bytes, which for this endpoint are gzip whether or not the
    // transport says so — sniff the magic bytes rather than trusting a header nobody replays.
    const text =
      body[0] === 0x1f && body[1] === 0x8b
        ? gunzipSync(body).toString('utf8')
        : body.toString('utf8');
    const payload = JSON.parse(text) as BootstrapPayload;
    if (!Array.isArray(payload.events) || !Array.isArray(payload.elements)) {
      throw new Error(`capture ${ts}: payload has no events/elements — not bootstrap-static`);
    }
    return payload;
  }

  private async politeFetch(url: string, cacheFile: string): Promise<Buffer> {
    const path = join(CACHE_DIR, cacheFile);
    // CDX listings grow as the archive does — only immutable captures are cached
    if (!cacheFile.startsWith('cdx-')) {
      try {
        return await readFile(path);
      } catch {
        // not cached yet
      }
    }
    const wait = this.lastFetchAt + FETCH_PAUSE_MS - Date.now();
    if (wait > 0) await new Promise((r) => setTimeout(r, wait));

    let lastError: Error | null = null;
    for (let attempt = 1; attempt <= 3; attempt += 1) {
      this.lastFetchAt = Date.now();
      try {
        this.log.log(`fetching ${url}`);
        const res = await fetch(url, {
          headers: { 'User-Agent': 'fpl-orchestrator availability ingest (B-015)' },
        });
        if (!res.ok) {
          throw new Error(`${res.status} ${res.statusText} for ${url}`);
        }
        const body = Buffer.from(await res.arrayBuffer());
        if (!cacheFile.startsWith('cdx-')) {
          await mkdir(CACHE_DIR, { recursive: true });
          await writeFile(path, body);
        }
        return body;
      } catch (err) {
        lastError = err as Error;
        // Wayback 5xxes routinely under load; a short backoff usually clears it
        await new Promise((r) => setTimeout(r, 2000 * attempt));
      }
    }
    throw lastError ?? new Error(`unreachable: ${url}`);
  }

  /**
   * Replace one season wholesale, in one transaction — same reasoning as the vaastav import
   * (B-038): an interrupted ingest must leave the previous state intact, not a hole.
   */
  private async replaceSeason(
    season: string,
    rows: Prisma.ArchiveAvailabilitySnapshotCreateManyInput[],
  ): Promise<number> {
    const written = await this.prisma.$transaction(
      async (tx) => {
        await tx.archiveAvailabilitySnapshot.deleteMany({ where: { season } });
        const CHUNK = 2000;
        let count = 0;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const res = await tx.archiveAvailabilitySnapshot.createMany({
            data: rows.slice(i, i + CHUNK),
          });
          count += res.count;
        }
        return count;
      },
      { timeout: 120_000 },
    );
    if (written !== rows.length) {
      throw new Error(
        `${season}: parsed ${rows.length} availability rows but wrote ${written} — rolled back`,
      );
    }
    return written;
  }
}
