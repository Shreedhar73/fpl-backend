import { HistoryRow } from '../projections/features';

/**
 * Start labels for the seven seasons that have none (B-040, plan 027 task 6).
 *
 * **Why this is the load-bearing task of the plan.** `starts` exists in the archive only from
 * 2023-24. Everything the minutes model is — the start curve, the substitute-appearance curve,
 * P(60+) given a start — is a regression ON that column, so seven of ten seasons cannot contribute
 * one row to the half of the model the guide calls "the real model". The rolling-origin referee
 * (D-034) measured the consequence exactly: 2 of 9 folds ran, and seven were refused for having no
 * start label anywhere in their training seasons.
 *
 * **What is recoverable, and it is most of it.** Minutes are recorded in all ten seasons, and minutes
 * are very nearly a start label already. Measured over the 34,442 rows where both are known:
 *
 *     minutes    90    80-89   70-79   60-69   55-59   50-54   45-49   30-44   15-29   1-14
 *     P(start)  1.000  0.994   0.981   0.974   0.936   0.775   0.505   0.148   0.030   0.010
 *
 * A player on the pitch at 90 minutes started, every time, 16,231 times out of 16,231. The ambiguity
 * lives in one band — 45 to 59 minutes, where an early-substituted starter and a half-time substitute
 * are the same row — and that band is 12% of appearances.
 *
 * **So the label is a PROBABILITY, not a guess dressed as a fact.** A hard label would hand the fit
 * 4% of its rows with the wrong answer and no way to know which; a probability hands it the same
 * information without the lie, and the fit already takes weights. `startProb` is what this module
 * produces; `starts` stays exactly as the archive recorded it — null where it was never recorded —
 * so nothing that SCORES a model can read an imputed label as truth.
 *
 * **Two things were tried and are recorded so they are not rebuilt.**
 *
 *  1. *Conditioning on the fixture's 22.* Every fixture has exactly 22 starters — verified, 1,140
 *     fixtures, no exceptions — so the per-fixture probabilities can be conditioned on summing to 22
 *     with an exact Poisson-binomial DP. It moves hard accuracy from 96.56% to 96.59% and the Brier
 *     score from 0.0231 to 0.0230. It is not worth the machinery, and minutes alone are very nearly
 *     sufficient.
 *  2. *Rank within the fixture as a second feature.* In the ambiguous band it carries nothing:
 *     P(start) is 0.509 inside the top 22 and 0.499 outside it.
 *
 * **What cannot be validated, and the backstop for it.** The calibration is fitted where truth exists
 * — 2023-24 onward, the five-substitute era — and applied to seasons with three substitutions, where
 * a long substitute appearance was rarer and the rule is probably MORE accurate rather than less.
 * Nothing in the archive can confirm that. The check that does not depend on it is arithmetic: a
 * season's imputed starters must come to 22 per fixture, which is a property of the football and not
 * of the era, and `startersPerFixture` reports it per season.
 */

/** Lower bound of each band, descending. The bands are the measurement above, not a smooth curve. */
const BANDS = [90, 80, 70, 60, 55, 50, 45, 30, 15, 1] as const;

export function minutesBand(minutes: number): number {
  for (const lower of BANDS) if (minutes >= lower) return lower;
  return 0;
}

export interface BandCalibration {
  band: number;
  rows: number;
  started: number;
  /** P(started | this band), Laplace-smoothed so a thin band cannot produce a 0 or a 1 by luck */
  probability: number;
}

export interface StartCalibration {
  /** band lower bound → calibration */
  bands: Map<number, BandCalibration>;
  /** seasons the calibration was fitted on */
  seasons: string[];
  rows: number;
}

/**
 * P(started | minutes) measured from the seasons that record it.
 *
 * Band 0 — no minutes at all — is not measured and not smoothed: a player who was not on the pitch
 * did not start, and the archive agrees without exception (52,313 rows with zero minutes, zero of
 * them a start). That is a rule of the game, so it is asserted rather than estimated.
 */
export function calibrateStarts(rows: HistoryRow[]): StartCalibration {
  const counts = new Map<number, { rows: number; started: number }>();
  const seasons = new Set<string>();
  let n = 0;
  for (const r of rows) {
    if (r.starts === null) continue;
    if (r.minutes === 0) {
      if (r.starts > 0) {
        throw new Error(
          `${r.season} round ${r.round} player ${r.playerCode}: recorded as a start with zero ` +
            `minutes. The imputation treats "did not play" as "did not start" with certainty, and ` +
            `this row says that rule is wrong.`,
        );
      }
      continue;
    }
    seasons.add(r.season);
    n += 1;
    const band = minutesBand(r.minutes);
    const cell = counts.get(band) ?? { rows: 0, started: 0 };
    cell.rows += 1;
    if (r.starts > 0) cell.started += 1;
    counts.set(band, cell);
  }

  const bands = new Map<number, BandCalibration>();
  for (const [band, cell] of counts) {
    bands.set(band, {
      band,
      rows: cell.rows,
      started: cell.started,
      probability: (cell.started + 0.5) / (cell.rows + 1),
    });
  }
  return { bands, seasons: [...seasons].sort(), rows: n };
}

/**
 * The imputed probability for one row, or null when the row does not need one.
 *
 * Returns null for a row that already carries a recorded label — the recorded one is what the fit
 * should use, and quietly replacing it with an estimate would make the three seasons of truth
 * indistinguishable from the seven of inference.
 */
export function startProbability(
  row: HistoryRow,
  calibration: StartCalibration,
): number | null {
  if (row.starts !== null) return null;
  if (row.minutes === 0) return 0;
  const band = calibration.bands.get(minutesBand(row.minutes));
  if (!band) {
    throw new Error(
      `no calibration for the ${minutesBand(row.minutes)}-minute band, fitted on ` +
        `${calibration.seasons.join(', ')}. A band with no calibration cannot be imputed, and ` +
        `guessing one would be the estimate this module exists to avoid.`,
    );
  }
  return band.probability;
}

/**
 * Attach `startProb` to every row that has no recorded start label.
 *
 * Returns new rows; the input is not mutated, and `starts` is never written. A caller that wants the
 * truth reads `starts` and gets null exactly where the archive has nothing, which is what every
 * scoring path already does.
 */
export function withImputedStarts(
  rows: HistoryRow[],
  calibration: StartCalibration = calibrateStarts(rows),
): HistoryRow[] {
  // Nothing to calibrate from — a caller that loaded only unlabelled seasons. Returning the rows
  // untouched is the honest answer: the alternative is a table borrowed from seasons this caller
  // did not ask for, which is an imputation nobody could see the provenance of.
  if (calibration.rows === 0) return rows;
  return rows.map((row) => {
    const startProb = startProbability(row, calibration);
    return startProb === null ? row : { ...row, startProb };
  });
}

export interface ImputationValidation {
  season: string;
  rows: number;
  /** rows where the hard label (probability ≥ 0.5) matches the recorded one */
  correct: number;
  accuracy: number;
  /** mean (p − outcome)², the metric that actually matters for a weighted fit */
  brier: number;
  /** imputed starters per fixture — must be 22, and it is a property of football, not of the era */
  startersPerFixture: number;
  fixtures: number;
}

/**
 * Score the imputation against the seasons that record the truth, leaving each one out of its own
 * calibration.
 *
 * Leave-one-season-out and not a single pooled fit: with three seasons of truth, calibrating on all
 * three and scoring one of them measures how well a table reproduces the rows that built it. The
 * difference is small here — the bands are enormous — and the discipline is not, because the same
 * shortcut on a thinner table would report a number that means nothing.
 */
export function validateImputation(rows: HistoryRow[]): ImputationValidation[] {
  const labelled = rows.filter((r) => r.starts !== null && r.minutes > 0);
  const seasons = [...new Set(labelled.map((r) => r.season))].sort();

  return seasons.map((season) => {
    const calibration = calibrateStarts(
      labelled.filter((r) => r.season !== season),
    );
    const seasonRows = labelled.filter((r) => r.season === season);
    let correct = 0;
    let brier = 0;
    let starters = 0;
    const fixtures = new Set<number>();
    for (const r of seasonRows) {
      const band = calibration.bands.get(minutesBand(r.minutes));
      const p = band ? band.probability : 0;
      const truth = (r.starts ?? 0) > 0 ? 1 : 0;
      if ((p >= 0.5 ? 1 : 0) === truth) correct += 1;
      brier += (p - truth) ** 2;
      starters += p;
      fixtures.add(r.fixture);
    }
    return {
      season,
      rows: seasonRows.length,
      correct,
      accuracy: seasonRows.length === 0 ? 0 : correct / seasonRows.length,
      brier: seasonRows.length === 0 ? 0 : brier / seasonRows.length,
      startersPerFixture: fixtures.size === 0 ? 0 : starters / fixtures.size,
      fixtures: fixtures.size,
    };
  });
}

/**
 * The gate, and it is arithmetic rather than statistics.
 *
 * Eleven players start a match for each side, so a fixture's start labels — recorded or imputed —
 * must come to 22. It is the one check that does not depend on the era the calibration was fitted in,
 * which is exactly the assumption the imputation cannot otherwise defend: three substitutes in
 * 2016-17 against five in 2025-26. `ArchiveService.verifyStarts` already applies the same 22 to the
 * recorded column; this applies it to the inferred one, per season, and a season that fails it is not
 * used.
 */
export const STARTERS_PER_FIXTURE = 22;
export const STARTERS_PER_FIXTURE_TOLERANCE = 0.5;

export interface SeasonImputation {
  season: string;
  rows: number;
  imputedRows: number;
  fixtures: number;
  startersPerFixture: number;
  passes: boolean;
}

export function summariseImputation(rows: HistoryRow[]): SeasonImputation[] {
  const bySeason = new Map<string, HistoryRow[]>();
  for (const r of rows) {
    const list = bySeason.get(r.season);
    if (list) list.push(r);
    else bySeason.set(r.season, [r]);
  }
  return [...bySeason.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([season, seasonRows]) => {
      const fixtures = new Set<number>();
      let starters = 0;
      let imputedRows = 0;
      for (const r of seasonRows) {
        fixtures.add(r.fixture);
        if (r.starts !== null) {
          if (r.starts > 0) starters += 1;
        } else if (r.startProb !== null && r.startProb !== undefined) {
          starters += r.startProb;
          if (r.minutes > 0) imputedRows += 1;
        }
      }
      const startersPerFixture =
        fixtures.size === 0 ? 0 : starters / fixtures.size;
      return {
        season,
        rows: seasonRows.length,
        imputedRows,
        fixtures: fixtures.size,
        startersPerFixture,
        passes:
          Math.abs(startersPerFixture - STARTERS_PER_FIXTURE) <=
          STARTERS_PER_FIXTURE_TOLERANCE,
      };
    });
}
