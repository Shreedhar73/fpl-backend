import { HistoryRow } from '../../projections/features';
import { Scoring } from '../../projections/scoring';
import { scoringForSeason } from '../../archive/archive-scoring';
import { withImputedStarts } from '../../archive/start-imputation';
import { fitParams } from '../fit';

/**
 * The imputed start labels, where they meet the fit (B-040, plan 027 task 6).
 *
 * Two claims are load-bearing and neither is visible in any report:
 *
 *  1. **`imputedStarts: false` is the fit that shipped.** If the flag leaked, every minutes parameter
 *     in the served model would have changed silently the moment the read path started attaching
 *     probabilities — and nothing downstream would say so, because the numbers would still be
 *     plausible.
 *  2. **A probability of exactly 1 or 0 must behave like a recorded label.** The fit now pushes two
 *     weighted points per row instead of one; at p ∈ {0, 1} the second carries zero weight, so the
 *     arithmetic must be identical to what it replaced. If it is not, the refactor changed the model
 *     while claiming to generalise it.
 */

const scoringFor = (season: string): Scoring => {
  const table = scoringForSeason(season);
  if (!table) throw new Error(`no scoring table for ${season}`);
  return Scoring.from(table.scoring);
};

const row = (
  over: Partial<HistoryRow> & {
    season: string;
    round: number;
    playerCode: number;
  },
): HistoryRow => ({
  fixture: over.round * 1000 + over.playerCode,
  webName: `P${over.playerCode}`,
  position: 'MID',
  teamCode: 1 + (over.playerCode % 2),
  opponentTeamCode: 2 - (over.playerCode % 2),
  wasHome: over.playerCode % 2 === 0,
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

/** A labelled season: nailed starters, rotation players, and bench cameos. */
const labelled = (season: string): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let round = 1; round <= 12; round++) {
    for (let p = 0; p < 24; p++) {
      const nailed = p < 12;
      const played = nailed || round % 2 === 0;
      out.push(
        row({
          season,
          round,
          playerCode: p,
          minutes: played ? (nailed ? 90 : 75) : 12,
          starts: played ? 1 : 0,
        }),
      );
    }
  }
  return out;
};

/** The same shape, with the labels stripped the way the archive strips them before 2023-24. */
const unlabelled = (season: string): HistoryRow[] =>
  labelled(season).map((r) => ({ ...r, starts: null }));

const fitReport = (rows: HistoryRow[], imputedStarts: boolean) =>
  fitParams({
    train: rows,
    defconTrain: [],
    validate: rows,
    defconValidate: [],
    scoringFor,
    imputedStarts,
  });

const fit = (rows: HistoryRow[], imputedStarts: boolean) =>
  fitParams({
    train: rows,
    defconTrain: [],
    validate: rows,
    defconValidate: [],
    scoringFor,
    imputedStarts,
  }).params.minutes;

describe('imputed start labels in the fit', () => {
  it('changes nothing when every row already carries a recorded label', () => {
    const rows = labelled('2024-25');
    const off = fit(rows, false);
    const on = fit(withImputedStarts(rows), true);
    // Identical, not merely close: with no row to impute, the two paths must be the same arithmetic.
    expect(on).toEqual(off);
  });

  /**
   * The sabotage this file is for. With the flag off, the probabilities must be as invisible as if
   * they had never been attached — otherwise the served fit moved the day the read path started
   * attaching them, and nothing downstream would have said so.
   *
   * Compared against the SAME corpus with `startProb` stripped, not against a corpus without the
   * unlabelled seasons: those rows change the feature walk whether or not their labels are read —
   * a player with an earlier season now has prior-season features — and that is a different effect
   * from the one being tested here.
   */
  it('ignores imputed rows entirely when the flag is off', () => {
    const withOld = withImputedStarts([
      ...unlabelled('2016-17'),
      ...labelled('2024-25'),
    ]);
    expect(withOld.some((r) => r.startProb !== undefined)).toBe(true);
    const stripped = withOld.map(({ startProb: _ignored, ...rest }) => rest);

    // Both arms see the same rows; one has probabilities it is told to ignore, the other has none.
    expect(fit(withOld, false)).toEqual(fit(stripped, true));
    expect(fit(withOld, false)).toEqual(fit(stripped, false));
  });

  /**
   * The counters that feed the thin-sample guards are counts of ROWS, and the imputation makes them
   * fractional. With the flag off they must be the integers they always were — a reported n that
   * quietly changed meaning is a number every later reader would misread.
   */
  it('leaves the flagged-sample counts alone with the flag off', () => {
    const withOld = withImputedStarts([
      ...unlabelled('2016-17'),
      ...labelled('2024-25'),
    ]);
    const stripped = withOld.map(({ startProb: _ignored, ...rest }) => rest);
    expect(fitReport(withOld, false).params.minutes.availability?.n).toEqual(
      fitReport(stripped, false).params.minutes.availability?.n,
    );
  });

  it('uses them when the flag is on, and the fit moves', () => {
    const labelledRows = labelled('2024-25');
    const withOld = withImputedStarts([
      ...unlabelled('2016-17'),
      ...labelledRows,
    ]);
    const off = fit(withOld, false);
    const on = fit(withOld, true);
    // Seven seasons' worth of extra evidence cannot leave every parameter where it was; if it does,
    // the flag is not reaching the curves and the whole task measures nothing.
    const moved =
      Math.abs(on.startIntercept - off.startIntercept) +
      Math.abs(on.startSlope - off.startSlope) +
      Math.abs(on.subAppearanceRate - off.subAppearanceRate);
    expect(moved).toBeGreaterThan(1e-6);
  });

  /**
   * A probability is not a coin flip. A row at p = 0.5 must contribute half to each class — so a
   * corpus of ambiguous rows moves the fitted frequencies toward the middle rather than toward
   * whichever side a hard threshold happened to pick.
   */
  it('splits an ambiguous row across both classes rather than rounding it', () => {
    const labelledRows = labelled('2024-25');
    const ambiguous = unlabelled('2016-17').map((r) => ({
      ...r,
      minutes: 50,
      startProb: 0.5,
    }));
    const rounded = unlabelled('2016-17').map((r) => ({
      ...r,
      minutes: 50,
      startProb: 1,
    }));
    const split = fit([...ambiguous, ...labelledRows], true);
    const hard = fit([...rounded, ...labelledRows], true);
    expect(split.startIntercept).not.toBeCloseTo(hard.startIntercept, 6);
  });
});
