import { HistoryRow } from '../../projections/features';
import {
  assertShape,
  coverageOf,
  expectedRounds,
  FIRST_SEASON_WITH,
  renderCoverage,
} from '../coverage';

const row = (
  over: Partial<HistoryRow> & { season: string; round: number },
): HistoryRow => ({
  fixture: over.round * 100,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: null,
  totalPoints: 2,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 1,
  saves: 0,
  bonus: 0,
  bps: 15,
  defensiveContribution: null,
  expectedGoals: null,
  expectedAssists: null,
  expectedGoalsConceded: null,
  ictIndex: 1,
  influence: 1,
  creativity: 1,
  threat: 1,
  value: 50,
  ...over,
});

/** A season of 38 rounds in the shape that season really has. */
const season = (label: string, over: Partial<HistoryRow> = {}): HistoryRow[] =>
  Array.from({ length: 38 }, (_, i) =>
    row({ season: label, round: i + 1, ...over }),
  );

const modern = (label: string, over: Partial<HistoryRow> = {}) =>
  season(label, {
    starts: 1,
    expectedGoals: 0.1,
    expectedAssists: 0.1,
    expectedGoalsConceded: 0.9,
    ...over,
  });

/** The archive as it is: three shapes, one boundary per column. */
const healthy = (): HistoryRow[] => [
  ...season('2021-22'),
  ...season('2022-23', {
    expectedGoals: 0.1,
    expectedAssists: 0.1,
    expectedGoalsConceded: 0.9,
  }).filter((r) => r.round !== 7),
  ...modern('2023-24'),
  ...modern('2024-25'),
  ...modern('2025-26', { defensiveContribution: 3 }),
];

describe('coverageOf', () => {
  it('reports the boundary of each column and the postponed round', () => {
    const coverage = coverageOf(healthy());
    const bySeason = new Map(coverage.map((c) => [c.season, c]));

    expect(bySeason.get('2021-22')!.columns.starts).toBe(0);
    expect(bySeason.get('2022-23')!.columns.starts).toBe(0);
    expect(bySeason.get('2022-23')!.columns.expectedGoals).toBe(37);
    expect(bySeason.get('2023-24')!.columns.starts).toBe(38);
    // Round 7 is not "missing" — the season is recorded as not having it, so a fold that indexes
    // rounds drops it rather than treating the gap as a fault to be chased.
    expect(bySeason.get('2022-23')!.roundsPresent).toBe(37);
    expect(bySeason.get('2022-23')!.missingRounds).toEqual([]);
    expect(bySeason.get('2023-24')!.roundsPresent).toBe(38);
    expect(bySeason.get('2023-24')!.missingRounds).toEqual([]);
  });
});

describe('assertShape', () => {
  it('passes on the archive as it actually is', () => {
    expect(() => assertShape(coverageOf(healthy()))).not.toThrow();
  });

  /**
   * The fault this file exists for. A column that stops arriving on a re-import reads exactly like a
   * season in which the thing never happened: the fit excludes the rows, the report shrinks, nothing
   * is red. So the disappearance is asserted, not reviewed.
   */
  it('throws when a season that had a column loses it', () => {
    const rows = healthy().map((r) =>
      r.season === '2024-25' ? { ...r, starts: null } : r,
    );
    expect(() => assertShape(coverageOf(rows))).toThrow(
      /2024-25\.starts: recorded as present/,
    );
  });

  it('throws when a column is populated for only some rows of a season', () => {
    const rows = healthy();
    const i = rows.findIndex((r) => r.season === '2024-25');
    rows[i] = { ...rows[i], starts: null };
    expect(() => assertShape(coverageOf(rows))).toThrow(
      /37 of 38 rows populated/,
    );
  });

  /**
   * Found by this assertion on its first run against the real database: 2019-20 runs 1..29 and then
   * 39..47, because the season was suspended in March 2020 and FPL renumbered the restart. The
   * previous version of this check expected 1..38 and called nine real rounds a hole in the import.
   */
  it('knows 2019-20 renumbered its restart, in both directions', () => {
    const rounds = expectedRounds('2019-20');
    expect(rounds.has(29)).toBe(true);
    expect(rounds.has(30)).toBe(false);
    expect(rounds.has(39)).toBe(true);
    expect(rounds.has(47)).toBe(true);
    expect(rounds.size).toBe(38);

    const covid = Array.from({ length: 38 }, (_, i) =>
      row({ season: '2019-20', round: i < 29 ? i + 1 : i + 10 }),
    );
    expect(() => assertShape(coverageOf(covid))).not.toThrow();
  });

  it('throws when a season carries a round label it should not', () => {
    const rows = [...healthy(), row({ season: '2024-25', round: 47 })];
    expect(() => assertShape(coverageOf(rows))).toThrow(
      /rounds 47 exist and should not/,
    );
  });

  it('throws on a missing round with no recorded reason, and names it', () => {
    const rows = healthy().filter(
      (r) => !(r.season === '2024-25' && r.round === 14),
    );
    expect(() => assertShape(coverageOf(rows))).toThrow(
      /2024-25: rounds 14 have no rows/,
    );
  });

  it('treats a column arriving early as data to record, not an error to work around', () => {
    const rows = healthy().map((r) =>
      r.season === '2021-22' ? { ...r, expectedGoals: 0.2 } : r,
    );
    expect(() => assertShape(coverageOf(rows))).toThrow(
      /update\s+FIRST_SEASON_WITH/,
    );
  });

  it('agrees with the boundaries the constant records', () => {
    expect(FIRST_SEASON_WITH.starts).toBe('2023-24');
    expect(FIRST_SEASON_WITH.expectedGoals).toBe('2022-23');
    expect(FIRST_SEASON_WITH.defensiveContribution).toBe('2025-26');
  });
});

describe('renderCoverage', () => {
  it('explains the irregular season and marks a real hole as one', () => {
    const explained = renderCoverage(coverageOf(healthy()), 'now');
    expect(explained).toMatch(/2022-23.*37 rounds.*postponed in full/);
    expect(explained).not.toMatch(/hole in the import/);

    const holed = renderCoverage(
      coverageOf(
        healthy().filter((r) => !(r.season === '2024-25' && r.round === 14)),
      ),
      'now',
    );
    expect(holed).toMatch(/2024-25.*MISSING 14.*hole in the import/);
  });
});
