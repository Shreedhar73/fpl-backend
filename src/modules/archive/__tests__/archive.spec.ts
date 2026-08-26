import { parseCsv, parseCsvRecords, int, intOrNull, bool, num } from '../csv';
import {
  elementToCode,
  elementToTeamId,
  expectedDefconCount,
  mapArchiveRow,
  teamIdToCode,
} from '../archive.mappers';
import { scoringForSeason, ARCHIVE_SCORING } from '../archive-scoring';

/**
 * Pure tests for the archive import (B-007 Phase 2b). No network, no DB.
 *
 * The parser cases are not hypothetical: a `split(',')` reader corrupts exactly the rows with a comma
 * in the name and leaves the other 99% looking right, which is a defect that reaches a fitted model
 * instead of a stack trace. The mapper cases are the two the real import would have got wrong — the
 * archive writes `GK` where we write `GKP`, and it carries a non-player element.
 */

describe('parseCsv', () => {
  it('keeps a comma inside a quoted field', () => {
    expect(parseCsv('a,b\n"Hwang, Hee-Chan",MID')).toEqual([
      ['a', 'b'],
      ['Hwang, Hee-Chan', 'MID'],
    ]);
  });

  it('unescapes a doubled quote', () => {
    expect(parseCsv('a\n"he said ""no"""')).toEqual([['a'], ['he said "no"']]);
  });

  it('keeps a newline inside a quoted field', () => {
    expect(parseCsv('a,b\n"line1\nline2",x')).toEqual([
      ['a', 'b'],
      ['line1\nline2', 'x'],
    ]);
  });

  it('handles CRLF and a trailing newline without inventing a row', () => {
    expect(parseCsv('a,b\r\n1,2\r\n')).toEqual([
      ['a', 'b'],
      ['1', '2'],
    ]);
  });
});

describe('parseCsvRecords', () => {
  it('keys cells by the header', () => {
    expect(parseCsvRecords('name,gw\nSalah,1')).toEqual([
      { name: 'Salah', gw: '1' },
    ]);
  });

  it('throws on a row whose width disagrees with the header', () => {
    // Padding or truncating here would turn a lost delimiter into wrong numbers in a fitted model.
    expect(() => parseCsvRecords('a,b,c\n1,2')).toThrow(/expected 3 cells/);
  });

  it('reads a numeric cell, and tells an empty cell apart from a zero', () => {
    const [r] = parseCsvRecords('a,b,c\n5,,0');
    expect(int(r, 'a')).toBe(5);
    expect(intOrNull(r, 'b')).toBeNull();
    expect(intOrNull(r, 'c')).toBe(0);
    expect(num(r, 'missing')).toBeNull();
    expect(() => int(r, 'b')).toThrow();
  });

  it("reads the archive's True/False booleans", () => {
    const [r] = parseCsvRecords('x,y\nTrue,False');
    expect(bool(r, 'x')).toBe(true);
    expect(bool(r, 'y')).toBe(false);
  });
});

describe('the season id maps', () => {
  const playersRaw = parseCsvRecords('id,code,team\n7,118748,3\n8,58822,11');
  const teams = parseCsvRecords('id,code,short_name\n3,3,ARS\n11,43,MCI');

  it('maps a per-season element id to the stable player code', () => {
    expect(elementToCode(playersRaw).get(7)).toBe(118748);
  });

  it('maps a per-season team id to the stable club code', () => {
    // The 1-20 team id is alphabetical and shifts on promotion; the code does not.
    expect(teamIdToCode(teams).get(11)).toBe(43);
    expect(elementToTeamId(playersRaw).get(8)).toBe(11);
  });
});

describe('mapArchiveRow', () => {
  const codeOf = new Map([[7, 118748]]);
  const teamCodeOfElement = () => 3;
  const teamCodeOfSeasonId = () => 43;

  const row = (over: Record<string, string> = {}) => ({
    name: 'Saka',
    position: 'MID',
    element: '7',
    round: '4',
    fixture: '31',
    opponent_team: '11',
    was_home: 'True',
    kickoff_time: '2025-09-13T14:00:00Z',
    minutes: '90',
    starts: '1',
    total_points: '9',
    goals_scored: '1',
    assists: '1',
    clean_sheets: '1',
    goals_conceded: '0',
    own_goals: '0',
    penalties_saved: '0',
    penalties_missed: '0',
    yellow_cards: '0',
    red_cards: '0',
    saves: '0',
    bonus: '2',
    bps: '40',
    expected_goals: '0.42',
    expected_assists: '0.31',
    expected_goals_conceded: '0.80',
    ict_index: '12.4',
    value: '101',
    selected: '1234567',
    xP: '6.6',
    ...over,
  });

  it('maps a full row onto the stable codes', () => {
    const m = mapArchiveRow(
      row(),
      '2025-26',
      codeOf,
      teamCodeOfElement,
      teamCodeOfSeasonId,
    )!;
    expect(m.playerCode).toBe(118748);
    expect(m.teamCode).toBe(3);
    expect(m.opponentTeamCode).toBe(43);
    expect(m.round).toBe(4);
    expect(m.fixture).toBe(31);
    expect(m.totalPoints).toBe(9);
    expect(m.wasHome).toBe(true);
  });

  it('translates GK to GKP — the archive does not use our label', () => {
    // Matching on 'GKP' drops every goalkeeper: ~3,400 rows a season, silently.
    const m = mapArchiveRow(
      row({ position: 'GK' }),
      '2025-26',
      codeOf,
      teamCodeOfElement,
      teamCodeOfSeasonId,
    )!;
    expect(m.position).toBe('GKP');
  });

  it('rejects the Assistant Manager element rather than scoring it as a player', () => {
    expect(
      mapArchiveRow(
        row({ position: 'AM' }),
        '2024-25',
        codeOf,
        teamCodeOfElement,
        teamCodeOfSeasonId,
      ),
    ).toBeNull();
  });

  it('rejects a row whose element is not in that season players_raw', () => {
    expect(
      mapArchiveRow(
        row({ element: '9999' }),
        '2025-26',
        codeOf,
        teamCodeOfElement,
        teamCodeOfSeasonId,
      ),
    ).toBeNull();
  });

  it('never reads xP — it is post-match contaminated', () => {
    const m = mapArchiveRow(
      row(),
      '2025-26',
      codeOf,
      teamCodeOfElement,
      teamCodeOfSeasonId,
    )!;
    expect(Object.values(m)).not.toContain(6.6);
  });

  it('leaves the defensive-contribution columns null for a season that had none', () => {
    // NULL because the category did not exist, which is not the same fact as a player doing nothing.
    const pre = row();
    delete (pre as Record<string, string>).defensive_contribution;
    const m = mapArchiveRow(
      pre,
      '2023-24',
      codeOf,
      teamCodeOfElement,
      teamCodeOfSeasonId,
    )!;
    expect(m.defensiveContribution).toBeNull();
    expect(m.tackles).toBeNull();
    expect(m.recoveries).toBeNull();
  });
});

describe('expectedDefconCount', () => {
  it('excludes recoveries for a defender and includes them for the rest', () => {
    expect(expectedDefconCount('DEF', 6, 2, 3)).toBe(8);
    expect(expectedDefconCount('MID', 6, 2, 3)).toBe(11);
    expect(expectedDefconCount('FWD', 6, 2, 3)).toBe(11);
  });

  it('is always zero for a goalkeeper, however much they clear', () => {
    // Caught by the importer on its first real run against 2025-26.
    expect(expectedDefconCount('GKP', 6, 2, 3)).toBe(0);
  });
});

describe('the reconstructed scoring tables', () => {
  it('covers all three held seasons', () => {
    for (const season of ['2023-24', '2024-25', '2025-26']) {
      expect(scoringForSeason(season)).toBeDefined();
    }
  });

  it('prices the defensive-contribution category at 0 before it existed', () => {
    // Not cosmetic. Scoring 2023-24 and 2024-25 with the current table gives every player points for
    // a category those seasons did not have, so the model learns to predict points that could not be
    // scored — and the fit answers by shrinking the term in the one season where it is real. Found
    // while fitting, in B-007 Phase 4.
    for (const season of ['2023-24', '2024-25']) {
      const t = scoringForSeason(season)!;
      expect(t.scoring.defensive_contribution).toEqual({
        GKP: 0,
        DEF: 0,
        MID: 0,
        FWD: 0,
      });
    }
    expect(scoringForSeason('2025-26')!.scoring.defensive_contribution.DEF).toBe(2);
  });

  it('says what each table was checked against', () => {
    for (const t of ARCHIVE_SCORING) {
      expect(t.source.length).toBeGreaterThan(20);
    }
  });
});
