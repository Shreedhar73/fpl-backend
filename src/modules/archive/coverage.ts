import { HistoryRow } from '../projections/features';

/**
 * What the archive actually holds, per season and per column (B-040, plan 027 task 3).
 *
 * **The archive is not rectangular, and every bug this file exists to catch comes from code that
 * assumed it was.** Ten seasons carry minutes, goals, assists, clean sheets, saves and bonus. Four
 * carry expected goals. Three carry a start label. One carries the defensive-contribution category.
 * A fit handed all ten and written for the newest shape does not fail — it reads the absent column as
 * zero and learns that nobody started a match for seven seasons.
 *
 * So the shape is measured from the rows, compared against what it was measured to be, and a
 * disagreement throws. The point is the direction nobody watches: a column is far more likely to
 * DISAPPEAR from a future import than to appear in an old season, and a silently emptied column is
 * indistinguishable from a season where the thing never happened.
 */

/** The nullable columns whose presence differs by season. Non-nullable ones cannot go missing. */
export const SHAPED_COLUMNS = [
  'starts',
  'expectedGoals',
  'expectedAssists',
  'expectedGoalsConceded',
  'defensiveContribution',
  'influence',
  'creativity',
  'threat',
] as const;

export type ShapedColumn = (typeof SHAPED_COLUMNS)[number];

/**
 * The first season each column exists in, measured 2026-08-28 against all 253,568 imported rows.
 *
 * Every one of these is all-or-nothing inside a season: a season either records the column for every
 * row or for none, which is why `assertShape` treats a partially-populated season as a fault rather
 * than as a shape.
 *
 * `starts` is the one that has been documented wrong. The schema comment said "NULL before 2022-23";
 * 2022-23 has **zero** non-null start rows and 2023-24 has 29,725. One season of difference, and it
 * is the season that decides whether the rolling-origin referee's 2024-25 fold can be fitted at all.
 */
export const FIRST_SEASON_WITH: Record<ShapedColumn, string> = {
  starts: '2023-24',
  expectedGoals: '2022-23',
  expectedAssists: '2022-23',
  expectedGoalsConceded: '2022-23',
  defensiveContribution: '2025-26',
  influence: '2016-17',
  creativity: '2016-17',
  threat: '2016-17',
};

/** Rounds an ordinary season has. Two seasons in the archive are not ordinary. */
const SEASON_ROUNDS = 38;

/**
 * The round labels a season is EXPECTED to carry — both directions, because both have bitten.
 *
 * Two seasons in ten are not 1..38, and neither is a bug:
 *
 *  - **2022-23** is missing round 7. It was postponed in full in September 2022 and never replayed
 *    under that number; the fixtures were redistributed. There is no row to import and there never
 *    will be.
 *  - **2019-20** runs 1..29 and then **39..47**. The season was suspended in March 2020 and FPL
 *    renumbered the restart, so nine gameweeks carry labels no other season uses. Found by this very
 *    assertion on its first real run against the database — the previous version of this file
 *    expected 1..38 and called rounds 30..38 a hole in the import.
 *
 * Checked in BOTH directions: an expected round with no rows is a hole, and a round label the season
 * should not have is an import reading someone else's season. A one-directional check would have
 * passed 2019-20 the moment its missing rounds were excused, while it silently carried nine rounds
 * nothing else in the codebase knows exist.
 *
 * **The archive holds COMPLETE seasons only, and that is a rule rather than an accident.** A season
 * imported while it is still being played will throw here, on its unplayed rounds — correctly. The
 * live season lives in `player_gameweek_stats`, and the fits treat the archive as finished history;
 * a half-season in it would be trained on as though its remaining rounds had been played and nobody
 * had featured.
 */
export function expectedRounds(season: string): Set<number> {
  if (season === '2019-20') {
    return new Set([
      ...Array.from({ length: 29 }, (_, i) => i + 1),
      ...Array.from({ length: 9 }, (_, i) => i + 39),
    ]);
  }
  const rounds = new Set(
    Array.from({ length: SEASON_ROUNDS }, (_, i) => i + 1),
  );
  if (season === '2022-23') rounds.delete(7);
  return rounds;
}

export interface SeasonCoverage {
  season: string;
  rows: number;
  /** rounds that produced at least one row */
  roundsPresent: number;
  /** rounds the season should carry and does not */
  missingRounds: number[];
  /** rounds the season carries and should not — an import reading the wrong season's shape */
  unexpectedRounds: number[];
  /** column → rows where it is non-null */
  columns: Record<ShapedColumn, number>;
}

export function coverageOf(rows: HistoryRow[]): SeasonCoverage[] {
  const bySeason = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season);
    if (list) list.push(r);
    else bySeason.set(r.season, [r]);
  }

  return [...bySeason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, seasonRows]) => {
      const rounds = new Set(seasonRows.map((r) => r.round));
      const columns = Object.fromEntries(
        SHAPED_COLUMNS.map((c) => [c, 0]),
      ) as Record<ShapedColumn, number>;
      for (const r of seasonRows) {
        for (const c of SHAPED_COLUMNS) {
          if (r[c] !== null && r[c] !== undefined) columns[c] += 1;
        }
      }
      const expected = expectedRounds(season);
      const missingRounds = [...expected]
        .filter((r) => !rounds.has(r))
        .sort((a, b) => a - b);
      const unexpectedRounds = [...rounds]
        .filter((r) => !expected.has(r))
        .sort((a, b) => a - b);
      return {
        season,
        rows: seasonRows.length,
        roundsPresent: rounds.size,
        missingRounds,
        unexpectedRounds,
        columns,
      };
    });
}

/**
 * Compare the measured shape against the recorded one and throw on any disagreement.
 *
 * Three faults, and the middle one is the reason this is an assertion rather than a report:
 *
 *  - a column populated for SOME rows of a season — the archive has never done this, and if it starts
 *    then every per-90 rate fitted on that season silently mixes a measured denominator with a
 *    missing one;
 *  - a column absent from a season that is recorded as having it — the disappearing-column case. A
 *    re-import against a changed upstream produces exactly this, and nothing else notices: the fit
 *    just excludes the rows and reports a smaller sample nobody reads;
 *  - a round missing for no recorded reason.
 *
 * A column appearing EARLIER than recorded is not a fault — it is new data, and the constant is what
 * is out of date. It is reported as a mismatch to be corrected here rather than as an error to be
 * worked around at the call site.
 */
export function assertShape(coverage: SeasonCoverage[]): void {
  const faults: string[] = [];
  for (const s of coverage) {
    for (const column of SHAPED_COLUMNS) {
      const present = s.columns[column];
      if (present !== 0 && present !== s.rows) {
        faults.push(
          `${s.season}.${column}: ${present} of ${s.rows} rows populated. The archive's columns are ` +
            `all-or-nothing per season; a partial column mixes a measured denominator with a ` +
            `missing one and no downstream report would show it.`,
        );
        continue;
      }
      const expected = s.season >= FIRST_SEASON_WITH[column];
      if (expected && present === 0) {
        faults.push(
          `${s.season}.${column}: recorded as present from ${FIRST_SEASON_WITH[column]} and the ` +
            `season has none. A column that disappears reads exactly like a season where the thing ` +
            `never happened.`,
        );
      }
      if (!expected && present > 0) {
        faults.push(
          `${s.season}.${column}: present in a season recorded as being before the column existed ` +
            `(from ${FIRST_SEASON_WITH[column]}). This is new data, not a bug — update ` +
            `FIRST_SEASON_WITH rather than working around it.`,
        );
      }
    }
    if (s.missingRounds.length > 0) {
      faults.push(
        `${s.season}: rounds ${s.missingRounds.join(', ')} have no rows and no recorded reason. ` +
          `The archive's two irregular seasons are recorded in \`expectedRounds\` — 2022-23 lost ` +
          `round 7 to a postponement and 2019-20 renumbered its restart 39..47. Anything else is a ` +
          `hole in the import.`,
      );
    }
    if (s.unexpectedRounds.length > 0) {
      faults.push(
        `${s.season}: rounds ${s.unexpectedRounds.join(', ')} exist and should not. A season ` +
          `carrying round labels nothing else in the codebase knows about is an import that read ` +
          `another season's shape.`,
      );
    }
  }
  if (faults.length > 0) {
    throw new Error(
      `archive shape does not match what it was measured to be:\n  - ${faults.join('\n  - ')}`,
    );
  }
}

/**
 * The coverage table, rendered.
 *
 * Generated rather than hand-written, because a hand-written table of what the archive contains is
 * exactly the artefact that goes stale the first time a season is imported — and it is read as
 * authoritative long after it stops being true. `reports/archive-coverage.md` says when it was
 * generated and from how many rows, so a stale one is visible as stale.
 */
export function renderCoverage(
  coverage: SeasonCoverage[],
  generated: string,
): string {
  const total = coverage.reduce((t, s) => t + s.rows, 0);
  const lines: string[] = [];
  lines.push('# Archive coverage — which column exists in which season');
  lines.push('');
  lines.push(
    `Generated ${generated} from ${total.toLocaleString()} rows over ${coverage.length} seasons. ` +
      'Regenerate with `pnpm report:coverage`.',
  );
  lines.push('');
  lines.push(
    'The archive is **not rectangular**, and code written for the newest shape does not fail on the ' +
      'oldest — it reads an absent column as zero. This table is what `assertShape` holds the ' +
      'database to on every read, so a column that stops arriving throws instead of quietly ' +
      'shrinking a sample.',
  );
  lines.push('');
  lines.push(`| season | rows | rounds | ${SHAPED_COLUMNS.join(' | ')} |`);
  lines.push(`|---|---:|---:|${SHAPED_COLUMNS.map(() => '---:').join('|')}|`);
  for (const s of coverage) {
    const cells = SHAPED_COLUMNS.map((c) =>
      s.columns[c] === 0 ? '—' : s.columns[c].toLocaleString(),
    );
    lines.push(
      `| ${s.season} | ${s.rows.toLocaleString()} | ${s.roundsPresent} | ${cells.join(' | ')} |`,
    );
  }
  lines.push('');
  lines.push('## What each column being absent costs');
  lines.push('');
  for (const column of SHAPED_COLUMNS) {
    const from = FIRST_SEASON_WITH[column];
    const seasons = coverage.filter((s) => s.columns[column] > 0);
    const rows = seasons.reduce((t, s) => t + s.rows, 0);
    lines.push(
      `- **${column}** — from ${from}. ${seasons.length} of ${coverage.length} seasons, ` +
        `${rows.toLocaleString()} rows.`,
    );
  }
  lines.push('');
  lines.push('## Irregular seasons');
  lines.push('');
  // A season is listed when it deviates from 1..38 in ANY way — a gap, a label nothing else uses, or
  // a count. 2019-20 has 38 rounds and none of them missing, and still needs saying: nine of its
  // labels are 39..47, which any code that assumes a round is in 1..38 will get wrong.
  const ordinary = (s: SeasonCoverage) =>
    s.missingRounds.length === 0 &&
    s.unexpectedRounds.length === 0 &&
    s.roundsPresent === SEASON_ROUNDS &&
    [...expectedRounds(s.season)].every((r) => r >= 1 && r <= SEASON_ROUNDS);
  const irregular = coverage.filter((s) => !ordinary(s));
  if (irregular.length === 0) {
    lines.push('None — every season carries all 38 rounds, labelled 1 to 38.');
  } else {
    for (const s of irregular) {
      const parts: string[] = [`${s.roundsPresent} rounds`];
      if (s.missingRounds.length > 0) {
        parts.push(`MISSING ${s.missingRounds.join(', ')}`);
      }
      if (s.unexpectedRounds.length > 0) {
        parts.push(`UNEXPECTED ${s.unexpectedRounds.join(', ')}`);
      }
      const note =
        s.season === '2019-20'
          ? 'suspended in March 2020; FPL renumbered the restart, so the season runs 1–29 then 39–47'
          : s.season === '2022-23'
            ? 'round 7 postponed in full in September 2022 and never replayed under that number'
            : 'no recorded reason — this is a hole in the import';
      lines.push(`- **${s.season}** — ${parts.join('; ')}. ${note}.`);
    }
  }
  lines.push('');
  return lines.join('\n');
}
