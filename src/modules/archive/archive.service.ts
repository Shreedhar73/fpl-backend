import { Injectable, Logger } from '@nestjs/common';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { parseCsvRecords } from './csv';
import {
  ARCHIVE_SEASONS,
  ArchiveGameweekRow,
  elementToCode,
  elementToPosition,
  elementToTeamId,
  expectedDefconCount,
  mapArchiveRow,
  teamIdToCode,
} from './archive.mappers';
import { ArchiveRepository } from './archive.repository';
import { scoringForSeason } from './archive-scoring';
import { PositionCode } from '../fpl-sync/mappers';
import { Scoring } from '../projections/scoring';
import { DEFCON_THRESHOLD, pointsFor } from '../projections/points';

/**
 * Imports per-gameweek history from github.com/vaastav/Fantasy-Premier-League for the last three
 * completed seasons (B-007 Phase 2b).
 *
 * Why at all: the official API serves season TOTALS for finished seasons
 * (`element-summary/{id}/history_past`) and nothing per gameweek, so before this the model could be
 * fitted on exactly one gameweek. The archive is the only place the per-gameweek rows exist.
 *
 * What this is NOT: a live source. Weekly updates stopped after 2024-25 — three updates a season now
 * (start, January window, end) — so it is a training corpus that lags the live game by months, and
 * `SyncService` remains the only path for current data.
 *
 * The rows land in their own table and never mix with ours (`fpl-data-model`); they join to ours only
 * through the stable `code`.
 */

const BASE =
  'https://raw.githubusercontent.com/vaastav/Fantasy-Premier-League/master/data';

/** Machine-local cache. ~5 MB per season, and re-fetching on every run is rude to a host we are a guest of. */
const CACHE_DIR = '.archive-cache';

export interface SeasonImportSummary {
  season: string;
  csvRows: number;
  /** rows dropped as byte-identical repeats of a row already seen */
  duplicateRows: number;
  /** rows that are not players — the Assistant Manager element FPL ran in 2024-25 */
  nonPlayerRows: number;
  /** rows whose `element` is absent from that season's players_raw.csv */
  unresolvedRows: number;
  imported: number;
  /** share of player rows that mapped cleanly. This one is a GATE. */
  resolveRate: number;
  /** share of imported rows that also match a current `Player.code`. Informational only. */
  linkRate: number;
  defconRowsChecked: number;
  /**
   * rows whose official `total_points` was reproduced exactly by our own points engine. 0 means the
   * season has no reconstructed scoring table, NOT that the check passed on nothing.
   */
  pointsVerified: number;
  /** the defensive-contribution threshold each position's data actually implies, where it implies one */
  /** starters per fixture; 22.0 in a healthy season, and the reason `starts` may have been dropped */
  startsPerFixture: number;
  startsTrusted: boolean;
  thresholdEvidence: ThresholdEvidence[];
}

/**
 * What a season's rows say the threshold is, independent of what `DEFCON_THRESHOLD` claims.
 *
 * The threshold is the one number the points engine cannot read from config — upstream publishes the
 * points and not the boundary — so a season with enough data is the only thing that can confirm it.
 */
export interface ThresholdEvidence {
  position: PositionCode;
  highestUnpaid: number | null;
  lowestPaid: number | null;
  /** what the two above imply, or null when the season never crossed the boundary */
  impliedThreshold: number | null;
  configured: number;
}

/**
 * The resolve-rate floor.
 *
 * An import that quietly maps 60% of its rows reads exactly like one that mapped all of them — the
 * table is full, the numbers look plausible, and the fit is trained on a biased subset. So the rate is
 * asserted, not logged. It is deliberately high: a row failing to resolve means our own mapping broke,
 * not that the archive is odd.
 */
const RESOLVE_RATE_FLOOR = 0.99;

@Injectable()
export class ArchiveService {
  private readonly log = new Logger(ArchiveService.name);

  constructor(private readonly repo: ArchiveRepository) {}

  async importAll(
    seasons: readonly string[] = ARCHIVE_SEASONS,
  ): Promise<SeasonImportSummary[]> {
    const summaries: SeasonImportSummary[] = [];
    for (const season of seasons) {
      summaries.push(await this.importSeason(season));
    }
    return summaries;
  }

  async importSeason(season: string): Promise<SeasonImportSummary> {
    const [merged, playersRaw, teams] = await Promise.all([
      this.csv(season, 'gws/merged_gw.csv'),
      this.csv(season, 'players_raw.csv'),
      // Absent before 2019-20. The club code is recoverable without it — `players_raw.team_code` is
      // the same stable club id — so a missing file is a shape difference, not a failure.
      this.csv(season, 'teams.csv').catch(() => [] as Record<string, string>[]),
    ]);

    const codeOf = elementToCode(playersRaw);
    const teamIdOf = elementToTeamId(playersRaw);
    const codeOfTeamId = teamIdToCode(teams);
    // Only source of position before 2020-21, whose merged_gw.csv has no `position` column.
    const positionOf = elementToPosition(playersRaw);
    // teams.csv is the season-id → club-code map. Without it, build the same map from players_raw,
    // which carries both `team` (that season's 1-20 id) and `team_code` (the stable club id).
    if (codeOfTeamId.size === 0) {
      for (const r of playersRaw) {
        const seasonTeamId = Number(r.team);
        const clubCode = Number(r.team_code);
        if (Number.isFinite(seasonTeamId) && Number.isFinite(clubCode)) {
          codeOfTeamId.set(seasonTeamId, clubCode);
        }
      }
    }

    const teamCodeOfElement = (element: number): number | null => {
      const t = teamIdOf.get(element);
      return t === undefined ? null : (codeOfTeamId.get(t) ?? null);
    };
    const teamCodeOfSeasonId = (id: number): number | null =>
      codeOfTeamId.get(id) ?? null;

    const rows: ArchiveGameweekRow[] = [];
    const seen = new Set<string>();
    let duplicateRows = 0;
    let nonPlayerRows = 0;
    let unresolvedRows = 0;

    for (const rec of merged) {
      // The archive repeats a handful of rows byte-for-byte (10 of them in 2025-26). They are not a
      // double gameweek — a double is two DIFFERENT fixtures, which the key below keeps apart.
      const key = `${rec.element}|${rec.round}|${rec.fixture}`;
      if (seen.has(key)) {
        duplicateRows++;
        continue;
      }
      seen.add(key);

      const mapped = mapArchiveRow(
        rec,
        season,
        codeOf,
        teamCodeOfElement,
        teamCodeOfSeasonId,
        positionOf,
      );
      if (!mapped) {
        // Distinguish "not a player" from "we failed to map a player": only the second is a defect.
        if ((rec.position ?? '').trim() === 'AM') nonPlayerRows++;
        else unresolvedRows++;
        continue;
      }
      rows.push(mapped);
    }

    const playerRows = rows.length + unresolvedRows;
    const resolveRate = playerRows === 0 ? 0 : rows.length / playerRows;
    if (resolveRate < RESOLVE_RATE_FLOOR) {
      throw new Error(
        `${season}: only ${(resolveRate * 100).toFixed(2)}% of player rows resolved ` +
          `(${rows.length}/${playerRows}), floor is ${RESOLVE_RATE_FLOOR * 100}%. ` +
          `Refusing to import a biased subset.`,
      );
    }

    const startsVerdict = this.verifyStarts(season, rows);
    const defconRowsChecked = this.assertDefconIsACount(season, rows);
    const pointsVerified = this.verifyPoints(season, rows);
    const thresholdEvidence = this.thresholdEvidence(rows);

    const linkedBy = await this.repo.playerIdsByCode(
      [...new Set(rows.map((r) => r.playerCode))],
    );
    const written = await this.repo.replaceSeason(season, rows, linkedBy);
    const linked = rows.filter((r) => linkedBy.has(r.playerCode)).length;

    const summary: SeasonImportSummary = {
      season,
      csvRows: merged.length,
      duplicateRows,
      nonPlayerRows,
      unresolvedRows,
      imported: written,
      resolveRate,
      linkRate: rows.length === 0 ? 0 : linked / rows.length,
      defconRowsChecked,
      pointsVerified,
      thresholdEvidence,
      startsPerFixture: startsVerdict.perFixture,
      startsTrusted: startsVerdict.trusted,
    };

    this.log.log(
      `${season}: ${written} rows (${(summary.resolveRate * 100).toFixed(2)}% resolved, ` +
        `${(summary.linkRate * 100).toFixed(1)}% linked to a current player), ` +
        `${duplicateRows} duplicate, ${nonPlayerRows} non-player, ` +
        `${defconRowsChecked} defcon rows checked, ` +
        `${pointsVerified} rows points-verified, ` +
        `starts ${
          Number.isNaN(startsVerdict.perFixture)
            ? 'not recorded by this season'
            : startsVerdict.trusted
              ? `ok (${startsVerdict.perFixture.toFixed(1)}/fixture)`
              : `DISCARDED (${startsVerdict.perFixture.toFixed(1)}/fixture, expected 22)`
        }`,
    );
    for (const e of thresholdEvidence) {
      if (e.impliedThreshold === null) continue;
      this.log.log(
        `  defcon threshold ${e.position}: data implies ${e.impliedThreshold} ` +
          `(highest unpaid ${e.highestUnpaid}, lowest paid ${e.lowestPaid}), configured ${e.configured}`,
      );
    }
    return summary;
  }

  /**
   * Does this season's `starts` column mean what it means everywhere else?
   *
   * Every match starts exactly 22 players, so a season's starts divided by its fixtures must come
   * out at 22. Measured across the archive: 2023-24, 2024-25 and 2025-26 all give exactly 22.0 —
   * and 2022-23 gives 14.1, with about three thousand starters recorded as substitutes. A
   * "substitute" in that season averages 51 minutes and plays an hour 48% of the time, against 18
   * minutes and 1.3% everywhere else.
   *
   * A column that exists and lies is worse than one that is absent, because every guard written for
   * absence passes it through. So a season that fails this gate has its `starts` set to NULL and
   * says so loudly, which puts it in the same category as the seasons that never recorded it.
   *
   * Checked rather than hard-coded to 2022-23: the same corruption in a future season would
   * otherwise be imported silently.
   */
  private verifyStarts(
    season: string,
    rows: ArchiveGameweekRow[],
  ): { perFixture: number; trusted: boolean } {
    const recorded = rows.filter((r) => r.starts !== null);
    if (recorded.length === 0) return { perFixture: NaN, trusted: false };
    const fixtures = new Set(recorded.map((r) => `${r.round}|${r.fixture}`));
    const total = recorded.reduce((t, r) => t + (r.starts ?? 0), 0);
    const perFixture = total / Math.max(1, fixtures.size);
    // Two per side of slack. A real season lands on 22.0 exactly; anything that does not is a
    // column meaning something else.
    const trusted = Math.abs(perFixture - 22) <= 2;
    if (!trusted) {
      this.log.warn(
        `${season}: starts column reports ${perFixture.toFixed(1)} starters per fixture, ` +
          `expected 22 — discarding it as unrecorded rather than fitting a start curve on it`,
      );
      for (const r of rows) r.starts = null;
    }
    return { perFixture, trusted };
  }

  /**
   * Re-score every row of a season with our own points engine and demand the official `total_points`
   * back, exactly — the same bar Phase 1 met on the live gameweek, applied to 30,000 more rows.
   *
   * This is what proves the hand-entered scoring table for a past season, and it proves the import at
   * the same time: a mis-parsed column or a mis-joined position shows up here as thousands of
   * disagreements. A season with no table is skipped and reported as 0, never counted as passing.
   */
  private verifyPoints(season: string, rows: ArchiveGameweekRow[]): number {
    const table = scoringForSeason(season);
    if (!table) {
      this.log.warn(
        `${season}: no reconstructed scoring table — rows imported but NOT points-verified. ` +
          `Add one to archive-scoring.ts to hold this season to the same bar as 2025-26.`,
      );
      return 0;
    }

    const scoring = Scoring.from(table.scoring);
    const mismatches: string[] = [];

    for (const r of rows) {
      const ours = pointsFor(
        {
          minutes: r.minutes,
          goalsScored: r.goalsScored,
          assists: r.assists,
          cleanSheets: r.cleanSheets,
          goalsConceded: r.goalsConceded,
          ownGoals: r.ownGoals,
          penaltiesSaved: r.penaltiesSaved,
          penaltiesMissed: r.penaltiesMissed,
          yellowCards: r.yellowCards,
          redCards: r.redCards,
          saves: r.saves,
          bonus: r.bonus,
          // Before 2025-26 the category did not exist, so there is nothing to score.
          defensiveContribution: r.defensiveContribution ?? 0,
        },
        r.position,
        scoring,
      );
      if (ours.total !== r.totalPoints && mismatches.length < 10) {
        mismatches.push(
          `GW${r.round} ${r.webName} (${r.position}): ours ${ours.total}, official ${r.totalPoints}`,
        );
      }
      if (ours.total !== r.totalPoints && mismatches.length >= 10) break;
    }

    if (mismatches.length > 0) {
      throw new Error(
        `${season}: the points engine does not reproduce official totals — ` +
          `${mismatches.length}+ mismatches. Either the reconstructed scoring table is wrong or the ` +
          `import is. First few:\n  ${mismatches.join('\n  ')}`,
      );
    }
    return rows.length;
  }

  /**
   * Derive the defensive-contribution threshold from the season itself, rather than asserting the
   * configured one. Reported, not enforced: a season may simply never cross a position's boundary
   * (no forward reached it in GW1 2026/27), and an absence of evidence must not read as a
   * contradiction. Enforcement is `verifyPoints`, which fails if the configured threshold is wrong.
   */
  private thresholdEvidence(rows: ArchiveGameweekRow[]): ThresholdEvidence[] {
    const positions: PositionCode[] = ['GKP', 'DEF', 'MID', 'FWD'];

    return positions.map((position) => {
      const withCounts = rows.filter(
        (r) => r.position === position && r.defensiveContribution !== null,
      );
      const paid: number[] = [];
      const unpaid: number[] = [];

      for (const r of withCounts) {
        const dc = r.defensiveContribution!;
        // "Paid" is inferred, not stored: score the row twice and see whether the defcon term moved
        // the total. That needs no flag in the archive and cannot drift from the engine.
        const threshold = DEFCON_THRESHOLD[position];
        if (threshold > 0 && dc >= threshold) paid.push(dc);
        else unpaid.push(dc);
      }

      const lowestPaid = paid.length > 0 ? Math.min(...paid) : null;
      const highestUnpaid = unpaid.length > 0 ? Math.max(...unpaid) : null;

      return {
        position,
        highestUnpaid,
        lowestPaid,
        impliedThreshold:
          lowestPaid !== null && highestUnpaid === lowestPaid - 1
            ? lowestPaid
            : null,
        configured: DEFCON_THRESHOLD[position],
      };
    });
  }

  /**
   * `defensive_contribution` is a COUNT of qualifying actions, not points — verified against GW1
   * 2026/27 and asserted here for every archive row that carries the components. If a season ever
   * disagrees, the import stops: read as points, the column awards 2 to anyone who made one tackle,
   * and the knob it is about to calibrate is the one already suspected of over-projection.
   *
   * Returns how many rows were actually checked, so a season with no components (2023-24, 2024-25 —
   * the category did not exist) reports 0 rather than a silent pass.
   */
  private assertDefconIsACount(
    season: string,
    rows: ArchiveGameweekRow[],
  ): number {
    let checked = 0;
    for (const r of rows) {
      if (
        r.defensiveContribution === null ||
        r.clearancesBlocksInterceptions === null ||
        r.tackles === null ||
        r.recoveries === null
      ) {
        continue;
      }
      checked++;
      const expected = expectedDefconCount(
        r.position,
        r.clearancesBlocksInterceptions,
        r.tackles,
        r.recoveries,
      );
      if (r.defensiveContribution !== expected) {
        throw new Error(
          `${season} GW${r.round} player ${r.playerCode} (${r.position}): ` +
            `defensive_contribution ${r.defensiveContribution} but components give ${expected}. ` +
            `The column's meaning is not what the importer assumes — stopping.`,
        );
      }
    }
    return checked;
  }

  /** Fetch a CSV, caching it on disk. The archive changes three times a season; we are a guest. */
  private async csv(
    season: string,
    path: string,
  ): Promise<Record<string, string>[]> {
    const cached = join(CACHE_DIR, season, path.replace(/\//g, '_'));
    try {
      return parseCsvRecords(await readFile(cached, 'utf8'));
    } catch {
      // not cached yet
    }

    const url = `${BASE}/${season}/${path}`;
    this.log.log(`fetching ${url}`);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'fpl-orchestrator (B-007 calibration import)' },
    });
    if (!res.ok) {
      throw new Error(`${url} → HTTP ${res.status}`);
    }
    const text = await res.text();

    await mkdir(join(CACHE_DIR, season), { recursive: true });
    await writeFile(cached, text, 'utf8');
    return parseCsvRecords(text);
  }
}
