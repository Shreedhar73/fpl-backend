import { HistoryRow } from '../../projections/features';
import {
  calibrateStarts,
  minutesBand,
  startProbability,
  summariseImputation,
  validateImputation,
  withImputedStarts,
} from '../start-imputation';

const row = (
  over: Partial<HistoryRow> & {
    season: string;
    round: number;
    minutes: number;
  },
): HistoryRow => ({
  fixture: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
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
  influence: null,
  creativity: null,
  threat: null,
  value: 50,
  ...over,
});

/**
 * A labelled season in the shape the real one has: 90-minute rows always started, short cameos never
 * did, and the 45-59 band is genuinely mixed — that band is the whole reason the label is a
 * probability.
 */
const labelled = (season: string): HistoryRow[] => [
  ...Array.from({ length: 100 }, (_, i) =>
    row({ season, round: 1, minutes: 90, starts: 1, playerCode: i }),
  ),
  ...Array.from({ length: 20 }, (_, i) =>
    row({
      season,
      round: 2,
      minutes: 50,
      starts: i < 15 ? 1 : 0,
      playerCode: 200 + i,
    }),
  ),
  ...Array.from({ length: 40 }, (_, i) =>
    row({ season, round: 3, minutes: 10, starts: 0, playerCode: 400 + i }),
  ),
  ...Array.from({ length: 30 }, (_, i) =>
    row({ season, round: 4, minutes: 0, starts: 0, playerCode: 600 + i }),
  ),
];

describe('minutesBand', () => {
  it('puts 90 in its own band, because that band is the certain one', () => {
    expect(minutesBand(90)).toBe(90);
    expect(minutesBand(89)).toBe(80);
    expect(minutesBand(45)).toBe(45);
    expect(minutesBand(44)).toBe(30);
    expect(minutesBand(0)).toBe(0);
  });
});

describe('calibrateStarts', () => {
  it('measures P(start) per band from the seasons that record it', () => {
    const c = calibrateStarts(labelled('2023-24'));
    expect(c.bands.get(90)!.probability).toBeGreaterThan(0.99);
    expect(c.bands.get(50)!.probability).toBeCloseTo(15.5 / 21, 6);
    expect(c.bands.get(1)!.probability).toBeLessThan(0.02);
    // Zero-minute rows are a rule, not a measurement, so they are not a band.
    expect(c.bands.has(0)).toBe(false);
    expect(c.seasons).toEqual(['2023-24']);
  });

  /**
   * The rule the whole module leans on: a player who was not on the pitch did not start. It holds in
   * 52,313 archive rows without exception, so a row that breaks it is a data fault worth stopping
   * for rather than a case to be smoothed over.
   */
  it('throws on a zero-minute row recorded as a start', () => {
    expect(() =>
      calibrateStarts([
        row({ season: '2023-24', round: 1, minutes: 0, starts: 1 }),
      ]),
    ).toThrow(/zero\s+minutes/);
  });
});

describe('startProbability', () => {
  const calibration = calibrateStarts(labelled('2023-24'));

  it('leaves a recorded label alone', () => {
    const recorded = row({
      season: '2023-24',
      round: 1,
      minutes: 45,
      starts: 0,
    });
    expect(startProbability(recorded, calibration)).toBeNull();
  });

  it('is certain about a row with no minutes', () => {
    expect(
      startProbability(
        row({ season: '2016-17', round: 1, minutes: 0 }),
        calibration,
      ),
    ).toBe(0);
  });

  it('is uncertain in the band that is genuinely uncertain', () => {
    const p = startProbability(
      row({ season: '2016-17', round: 1, minutes: 50 }),
      calibration,
    )!;
    expect(p).toBeGreaterThan(0.5);
    expect(p).toBeLessThan(0.9);
  });

  it('throws rather than guessing when a band was never calibrated', () => {
    const thin = calibrateStarts([
      row({ season: '2023-24', round: 1, minutes: 90, starts: 1 }),
    ]);
    expect(() =>
      startProbability(row({ season: '2016-17', round: 1, minutes: 50 }), thin),
    ).toThrow(/no calibration for the 50-minute band/);
  });
});

describe('withImputedStarts', () => {
  it('never writes `starts`, so a scorer still sees what the archive recorded', () => {
    const rows = [
      ...labelled('2023-24'),
      row({ season: '2016-17', round: 1, minutes: 90 }),
      row({ season: '2016-17', round: 2, minutes: 50 }),
    ];
    const out = withImputedStarts(rows);
    const old = out.filter((r) => r.season === '2016-17');
    expect(old.every((r) => r.starts === null)).toBe(true);
    expect(old[0].startProb).toBeGreaterThan(0.99);
    expect(old[1].startProb).toBeGreaterThan(0.5);
    // A row that already had a label is returned untouched, without a probability beside it.
    expect(
      out
        .filter((r) => r.season === '2023-24')
        .every((r) => r.startProb === undefined),
    ).toBe(true);
  });

  it('imputes nothing when there is nothing to calibrate from', () => {
    const rows = [row({ season: '2016-17', round: 1, minutes: 50 })];
    expect(withImputedStarts(rows)[0].startProb).toBeUndefined();
  });
});

describe('validateImputation', () => {
  it('scores each season against a calibration that never saw it', () => {
    const results = validateImputation([
      ...labelled('2023-24'),
      ...labelled('2024-25'),
    ]);
    expect(results.map((r) => r.season)).toEqual(['2023-24', '2024-25']);
    for (const r of results) {
      // The 50-minute band is 75% starters in this fixture, so the hard label is right 75% of the
      // time there and right everywhere else — well above 0.5 and well below perfect.
      expect(r.accuracy).toBeGreaterThan(0.9);
      expect(r.accuracy).toBeLessThan(1);
      expect(r.brier).toBeGreaterThan(0);
      expect(r.brier).toBeLessThan(0.1);
    }
  });
});

describe('summariseImputation — the gate that does not depend on the era', () => {
  /**
   * Eleven a side start a match, so a fixture's start labels must come to 22 whatever the
   * substitution rules were that year. It is the one check on the imputation that the archive cannot
   * argue with, and the only defence against a calibration fitted in the five-substitute era being
   * applied to the three-substitute one.
   */
  const fixture = (season: string, starters: number, subs: number) => [
    ...Array.from({ length: starters }, (_, i) =>
      row({ season, round: 1, minutes: 90, playerCode: i }),
    ),
    ...Array.from({ length: subs }, (_, i) =>
      row({ season, round: 1, minutes: 10, playerCode: 100 + i }),
    ),
  ];

  it('passes a fixture whose imputed starters come to 22', () => {
    const rows = withImputedStarts([
      ...labelled('2023-24'),
      ...fixture('2016-17', 22, 8),
    ]);
    const old = summariseImputation(rows).find((s) => s.season === '2016-17')!;
    expect(old.startersPerFixture).toBeCloseTo(22, 1);
    expect(old.passes).toBe(true);
  });

  it('fails a fixture that does not, instead of reporting a number nobody reads', () => {
    const rows = withImputedStarts([
      ...labelled('2023-24'),
      ...fixture('2016-17', 26, 4),
    ]);
    const old = summariseImputation(rows).find((s) => s.season === '2016-17')!;
    expect(old.startersPerFixture).toBeGreaterThan(22.5);
    expect(old.passes).toBe(false);
  });
});
