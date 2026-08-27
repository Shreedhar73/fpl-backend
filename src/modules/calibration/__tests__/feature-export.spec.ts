import { HistoryRow } from '../../projections/features';
import { FITTED_PARAMS } from '../../projections/fitted';
import { scoringForSeason } from '../../archive/archive-scoring';
import { Scoring } from '../../projections/scoring';

/** The same per-season resolver the runs use; every test season here has a reconstructed table. */
const scoringFor = (season: string): Scoring => {
  const t = scoringForSeason(season);
  if (!t) throw new Error(`no scoring table for ${season}`);
  return Scoring.from(t.scoring);
};
import { exportFeatures, featureNames, toCsv, WINDOWS } from '../feature-export';

const row = (over: Partial<HistoryRow> & { round: number }): HistoryRow => ({
  season: '2025-26',
  fixture: over.round * 100 + (over.playerCode ?? 1),
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: 1,
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
  expectedGoals: 0.1,
  expectedAssists: 0.1,
  expectedGoalsConceded: 1.0,
  ictIndex: 5.0,
  influence: 6.0,
  creativity: 4.0,
  threat: 30,
  value: 50,
  ...over,
});

/** Two players, opposite sides of one fixture per round. */
const season = (
  rounds: number,
  over: (r: number, code: number) => Partial<HistoryRow> = () => ({}),
): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let r = 1; r <= rounds; r++) {
    out.push(row({ round: r, playerCode: 1, teamCode: 1, opponentTeamCode: 2, fixture: r, ...over(r, 1) }));
    out.push(
      row({
        round: r,
        playerCode: 2,
        webName: 'Other',
        teamCode: 2,
        opponentTeamCode: 1,
        wasHome: false,
        fixture: r,
        ...over(r, 2),
      }),
    );
  }
  return out;
};

const at = (
  rows: ReturnType<typeof exportFeatures>,
  round: number,
  code = 1,
) => rows.find((r) => r.round === round && r.playerCode === code)!;

describe('the feature export (B-034)', () => {
  it('emits one row per player per fixture, skipping debuts like the harness does', () => {
    const rows = exportFeatures(season(3), FITTED_PARAMS, scoringFor);
    // round 1 is a debut for both players (matchesSample 0) and is skipped; rounds 2-3 emit.
    expect(rows.map((r) => `${r.round}:${r.playerCode}`).sort()).toEqual([
      '2:1',
      '2:2',
      '3:1',
      '3:2',
    ]);
  });

  it('windows are means over the last n matches', () => {
    const rows = exportFeatures(season(4, (r, code) => (code === 1 ? { totalPoints: r * 10 } : {})), FITTED_PARAMS, scoringFor);
    const r4 = at(rows, 4);
    // history before round 4: rounds 1-3 with 10, 20, 30 points
    expect(r4.features.get('p_points_1')).toBe(30);
    expect(r4.features.get('p_points_3')).toBe(20);
    expect(r4.features.get('p_points_38')).toBe(20);
  });

  it('a window with no history is missing, never zero', () => {
    const rows = exportFeatures(season(2), FITTED_PARAMS, scoringFor);
    const r2 = at(rows, 2);
    // one match of history exists, so windows are defined...
    expect(r2.features.get('p_points_5')).not.toBeNull();
    // ...but a player emitted with zero TEAM history would be null. Simulate by checking the CSV
    // renders null as an empty cell rather than "0".
    const csv = toCsv([
      { ...r2, features: new Map([...r2.features, ['p_points_5', null]]) },
    ]);
    const header = csv.split('\n')[0].split(',');
    const cells = csv.split('\n')[1].split(',');
    expect(cells[header.indexOf('p_points_5')]).toBe('');
  });

  it('team windows count a double gameweek as two matches, not one', () => {
    // Round 2 is a DGW for both teams: two fixtures, distinct fixture ids.
    const rows: HistoryRow[] = [
      ...season(1),
      row({ round: 2, playerCode: 1, fixture: 21, goalsScored: 1 }),
      row({ round: 2, playerCode: 2, teamCode: 2, opponentTeamCode: 1, wasHome: false, fixture: 21 }),
      row({ round: 2, playerCode: 1, fixture: 22, goalsScored: 3 }),
      row({ round: 2, playerCode: 2, teamCode: 2, opponentTeamCode: 1, wasHome: false, fixture: 22 }),
      ...season(3).filter((r) => r.round === 3),
    ];
    const out = exportFeatures(rows, FITTED_PARAMS, scoringFor);
    const r3 = at(out, 3);
    // team 1 has 3 team-matches (R1, R2a, R2b): goals 0, 1, 3 -> last-1 mean 3, last-3 mean 4/3
    expect(r3.features.get('t_goalsFor_1')).toBe(3);
    expect(r3.features.get('t_goalsFor_3')).toBeCloseTo(4 / 3, 10);
  });

  it('an own goal counts for the team that did not kick it, both ways', () => {
    const rows: HistoryRow[] = [
      ...season(1, (r, code) => (code === 1 ? { ownGoals: 1 } : {})),
      ...season(2).filter((r) => r.round === 2),
    ];
    const out = exportFeatures(rows, FITTED_PARAMS, scoringFor);
    const r2 = at(out, 2);
    // player 1 (team 1) scored an OG in round 1: team 2 gains a goal for, team 1 a goal against.
    expect(r2.features.get('t_goalsAgainst_1')).toBe(1);
    expect(r2.features.get('o_goalsFor_1')).toBe(1);
  });

  // The leak the entry exists to prevent, both directions.
  describe('the time cut', () => {
    it('a haul AFTER the emitted round does not move its features', () => {
      const quiet = exportFeatures(season(6), FITTED_PARAMS, scoringFor);
      const loud = exportFeatures(season(6, (r, code) =>
          r >= 4 && code === 1
            ? { totalPoints: 25, goalsScored: 3, expectedGoals: 2.4 }
            : {},
        ), FITTED_PARAMS, scoringFor);
      const a = at(quiet, 3);
      const b = at(loud, 3);
      expect([...b.features.entries()]).toEqual([...a.features.entries()]);
    });

    it('but the SAME haul is visible to later rounds — the instrument is not stuck', () => {
      const quiet = exportFeatures(season(6), FITTED_PARAMS, scoringFor);
      const loud = exportFeatures(season(6, (r, code) =>
          r >= 4 && code === 1
            ? { totalPoints: 25, goalsScored: 3, expectedGoals: 2.4 }
            : {},
        ), FITTED_PARAMS, scoringFor);
      expect(at(loud, 6).features.get('p_points_1')).not.toEqual(
        at(quiet, 6).features.get('p_points_1'),
      );
    });

    it('windows do not cross a season boundary', () => {
      const twoSeasons = [
        ...season(3).map((r) => ({ ...r, season: '2024-25' })),
        ...season(3),
      ];
      const out = exportFeatures(twoSeasons, FITTED_PARAMS, scoringFor);
      const r2 = at(
        out.filter((r) => r.season === '2025-26'),
        2,
      );
      // only round 1 of 2025-26 is in the window; 2024-25 history is cleared
      expect(r2.features.get('p_points_38')).toBe(2);
    });
  });

  it('a nullable field averages the matches that have it, and is missing when none do', () => {
    // player 1: round 1 has no split (null), rounds 2-3 carry threat 30 and 60.
    const rows = exportFeatures(season(4, (r, code) =>
        code === 1
          ? r === 1
            ? { influence: null, creativity: null, threat: null }
            : { threat: r * 15 } // r2: 30, r3: 45
          : {},
      ), FITTED_PARAMS, scoringFor);
    const r4 = at(rows, 4);
    // window of 3 sees rounds 1-3: null, 30, 45 -> mean over present = 37.5, not (0+30+45)/3
    expect(r4.features.get('p_threat_3')).toBeCloseTo(37.5, 10);
    const r2 = at(rows, 2);
    // window sees only round 1, which has no split: missing, never zero
    expect(r2.features.get('p_threat_1')).toBeNull();
    // and the non-nullable field on the same row is still defined
    expect(r2.features.get('p_points_1')).not.toBeNull();
  });

  it('the CSV column count matches the declared names', () => {
    const rows = exportFeatures(season(3), FITTED_PARAMS, scoringFor);
    const csv = toCsv(rows);
    const header = csv.split('\n')[0].split(',');
    expect(header.length).toBe(8 + featureNames().length);
    expect(new Set(WINDOWS).size).toBe(5);
  });
});
