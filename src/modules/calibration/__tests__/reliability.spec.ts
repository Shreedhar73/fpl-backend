import {
  BinaryPair,
  brierScore,
  decileTable,
  reliabilityCurve,
} from '../reliability';
import { realisedOutcomes } from '../harness';
import { HistoryRow } from '../../projections/features';

/**
 * B-013 — the instruments, and the two ways they can pass while measuring nothing.
 *
 * A reliability curve and a Brier score are arithmetic, and arithmetic tests on them are the easy
 * half. The tests that matter here are:
 *
 *  1. **A perfectly calibrated predictor scores reliability ≈ 0, and a shifted one does not.** If a
 *     constant offset does not move the reliability term, the term is not measuring calibration and
 *     every table built on it is decoration.
 *  2. **The realised counterparts mean what the model's terms mean.** `cleanSheets > 0` and
 *     `minutes >= 60` are the pairings the whole report rests on; getting one wrong produces a curve
 *     that is confidently about the wrong question, and nothing downstream would say so.
 */

/**
 * A deterministic pseudo-random stream. `Math.random()` cannot be replayed, so a sabotage run that
 * fails once could not be reproduced — the whole point of the sabotage.
 */
function stream(seed: number): () => number {
  let state = seed;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state % 100000) / 100000;
  };
}

/** `n` draws where the outcome really does happen with probability `p`. */
function calibratedPairs(n: number, seed = 12345): BinaryPair[] {
  const rand = stream(seed);
  const out: BinaryPair[] = [];
  for (let i = 0; i < n; i++) {
    const p = rand();
    out.push({ p, y: rand() < p ? 1 : 0 });
  }
  return out;
}

describe('reliabilityCurve', () => {
  it('puts each probability in the bin that contains it, and 1.0 in the last bin', () => {
    const curve = reliabilityCurve([
      { p: 0, y: 0 },
      { p: 0.05, y: 1 },
      { p: 0.55, y: 1 },
      { p: 1, y: 1 },
    ]);
    expect(curve[0].n).toBe(2);
    expect(curve[5].n).toBe(1);
    expect(curve[9].n).toBe(1);
    expect(curve.reduce((s, b) => s + b.n, 0)).toBe(4);
  });

  it('reports the observed rate, not the predicted one', () => {
    const curve = reliabilityCurve([
      { p: 0.95, y: 0 },
      { p: 0.95, y: 0 },
    ]);
    expect(curve[9].meanPredicted).toBeCloseTo(0.95, 6);
    expect(curve[9].observedRate).toBe(0);
  });
});

describe('brierScore', () => {
  it('is 0 for a predictor that is always right and certain', () => {
    const b = brierScore([
      { p: 1, y: 1 },
      { p: 0, y: 0 },
    ]);
    expect(b.score).toBe(0);
    expect(b.reliability).toBe(0);
  });

  it('a well-calibrated predictor has near-zero reliability', () => {
    const b = brierScore(calibratedPairs(20000));
    expect(b.n).toBe(20000);
    expect(b.reliability).toBeLessThan(0.001);
    expect(b.skillScore).toBeGreaterThan(0);
  });

  /**
   * THE SABOTAGE. Shift every probability by a constant and the outcomes stay put. If the
   * reliability term does not rise, it is not measuring calibration.
   */
  it('a constant shift breaks calibration and the reliability term says so', () => {
    const honest = calibratedPairs(20000);
    const shifted = honest.map((r) => ({
      p: Math.min(1, r.p + 0.25),
      y: r.y,
    }));

    const before = brierScore(honest);
    const after = brierScore(shifted);

    expect(after.reliability).toBeGreaterThan(before.reliability * 20);
    expect(after.reliability).toBeGreaterThan(0.03);
    // The shift does not change what happened, so the base rate must be identical — a moved base
    // rate would mean the test changed the outcome as well as the forecast and proves nothing.
    expect(after.baseRate).toBeCloseTo(before.baseRate, 10);
  });

  /**
   * The second sabotage: replace the forecast with a constant 0.5, the shape B-013 is about. A term
   * that has stopped discriminating keeps a plausible Brier score and loses its resolution.
   */
  it('a constant 0.5 forecast keeps a plausible Brier score and has no resolution', () => {
    const honest = calibratedPairs(20000);
    const flat = honest.map((r) => ({ p: 0.5, y: r.y }));

    const before = brierScore(honest);
    const after = brierScore(flat);

    expect(after.resolution).toBeCloseTo(0, 6);
    expect(before.resolution).toBeGreaterThan(0.05);
    expect(after.skillScore).toBeLessThan(before.skillScore);
  });

  it('a rare event predicted as never scores well and is caught by the skill score', () => {
    const pairs: BinaryPair[] = Array.from({ length: 10000 }, (_, i) => ({
      p: 0,
      y: i < 200 ? 1 : 0,
    }));
    const b = brierScore(pairs);
    expect(b.score).toBeCloseTo(0.02, 3); // looks excellent
    expect(b.skillScore).toBeLessThanOrEqual(0); // and knows nothing
  });

  it('score ≈ reliability − resolution + uncertainty, to binning error', () => {
    const b = brierScore(calibratedPairs(20000));
    expect(b.reliability - b.resolution + b.uncertainty).toBeCloseTo(
      b.score,
      2,
    );
  });
});

describe('decileTable', () => {
  it('keeps identical predictions in one bucket rather than splitting the tie', () => {
    const pairs = Array.from({ length: 100 }, (_, i) => ({
      predicted: i < 90 ? 0 : 1,
      actual: i < 90 ? 0 : 1,
    }));
    const table = decileTable(pairs);
    const zeroBuckets = table.filter((r) => r.meanPredicted === 0);
    expect(zeroBuckets).toHaveLength(1);
    expect(zeroBuckets[0].n).toBe(90);
    expect(table.reduce((s, r) => s + r.n, 0)).toBe(100);
  });

  it('is monotone in the prediction and reports the realised mean beside it', () => {
    const pairs = Array.from({ length: 1000 }, (_, i) => ({
      predicted: i / 1000,
      actual: (i / 1000) * 2,
    }));
    const table = decileTable(pairs);
    expect(table).toHaveLength(10);
    for (let i = 1; i < table.length; i++) {
      expect(table[i].meanPredicted).toBeGreaterThan(
        table[i - 1].meanPredicted,
      );
    }
    expect(table[9].meanActual).toBeCloseTo(table[9].meanPredicted * 2, 6);
  });
});

const historyRow = (over: Partial<HistoryRow>): HistoryRow => ({
  season: '2025-26',
  round: 1,
  fixture: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'DEF',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 0,
  starts: 0,
  totalPoints: 0,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  saves: 0,
  bonus: 0,
  bps: 0,
  defensiveContribution: null,
  expectedGoals: 0,
  expectedAssists: 0,
  value: 50,
  ...over,
});

describe('realisedOutcomes', () => {
  it('pairs each model term with the outcome that term is about', () => {
    const r = realisedOutcomes(
      historyRow({
        minutes: 90,
        starts: 1,
        cleanSheets: 1,
        goalsConceded: 0,
        bonus: 2,
        bps: 30,
        defensiveContribution: 12,
      }),
    );
    expect(r.started).toBe(1);
    expect(r.played).toBe(1);
    expect(r.sixtyPlus).toBe(1);
    expect(r.cleanSheet).toBe(1);
    expect(r.bonusAtLeastOne).toBe(1);
    expect(r.defcon).toBe(1); // DEF threshold is 10
  });

  it('59 minutes is not 60, which is the whole hinge of two scoring rules', () => {
    expect(realisedOutcomes(historyRow({ minutes: 59 })).sixtyPlus).toBe(0);
    expect(realisedOutcomes(historyRow({ minutes: 60 })).sixtyPlus).toBe(1);
  });

  it('an unused substitute started nothing and played nothing', () => {
    const r = realisedOutcomes(historyRow({ minutes: 0, starts: 0 }));
    expect(r.played).toBe(0);
    expect(r.started).toBe(0);
    expect(r.sixtyPlus).toBe(0);
  });

  /**
   * A season with no defensive-contribution category must produce `null`, not 0. Scoring those rows
   * as misses would convict the term of an error the data cannot support — and it would look exactly
   * like a well-behaved measurement.
   */
  it('a season without the defcon category yields null rather than a miss', () => {
    const r = realisedOutcomes(
      historyRow({ season: '2023-24', defensiveContribution: null }),
    );
    expect(r.defcon).toBeNull();
    expect(r.defconActions).toBeNull();
  });

  it('a goalkeeper has no defcon threshold, so the term is undefined for them', () => {
    const r = realisedOutcomes(
      historyRow({ position: 'GKP', defensiveContribution: 4 }),
    );
    expect(r.defcon).toBeNull();
  });

  it('a defender on 9 actions misses the threshold of 10', () => {
    expect(
      realisedOutcomes(historyRow({ defensiveContribution: 9 })).defcon,
    ).toBe(0);
    expect(
      realisedOutcomes(historyRow({ defensiveContribution: 10 })).defcon,
    ).toBe(1);
  });

  it('a midfielder needs 12, not 10', () => {
    expect(
      realisedOutcomes(
        historyRow({ position: 'MID', defensiveContribution: 10 }),
      ).defcon,
    ).toBe(0);
    expect(
      realisedOutcomes(
        historyRow({ position: 'MID', defensiveContribution: 12 }),
      ).defcon,
    ).toBe(1);
  });
});
