import { PredictionRow } from '../harness';
import { predictionRow } from './prediction-row';
import {
  ORDERING_VIEWS,
  orderingByRound,
  pointsCaptured,
  precisionAtK,
  rankDescending,
  spearman,
  summariseOrdering,
} from '../ordering';

/**
 * B-012 Phase 1 — ordering.
 *
 * The tests that matter here are not the arithmetic. They are the two that would let a broken
 * ordering metric report a good number: tie handling (because FPL outcomes are mostly ties) and the
 * shuffle (because a metric that survives a shuffle is measuring the round, not the model).
 */

const row = (over: Partial<PredictionRow>): PredictionRow =>
  predictionRow(over);

/** A deterministic shuffle — an unseeded one makes a sabotage run unreproducible. */
function seededShuffle<T>(items: T[], seed: number): T[] {
  const out = [...items];
  let state = seed;
  const next = () => {
    // xorshift32 — small, deterministic, and not Math.random(), which cannot be replayed.
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return Math.abs(state) / 2 ** 31;
  };
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(next() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

describe('ranks', () => {
  it('averages ranks within a tie, because FPL outcomes are mostly ties', () => {
    // Three players on 0 is the normal case in any gameweek, not an edge case. Ranking them
    // 2, 3, 4 asserts an order the data does not contain.
    expect(rankDescending([5, 0, 0, 0])).toEqual([1, 3, 3, 3]);
  });

  it('is undefined, not zero, when one side has no variation', () => {
    // A round where nobody scored says nothing about the ranking. Reporting 0 would average a
    // fabricated failure into the season.
    expect(spearman([1, 2, 3], [4, 4, 4])).toBeNull();
  });

  it('is 1 for a perfect ranking and −1 for a perfectly reversed one', () => {
    expect(spearman([3, 2, 1], [30, 20, 10])).toBeCloseTo(1, 9);
    expect(spearman([3, 2, 1], [10, 20, 30])).toBeCloseTo(-1, 9);
  });
});

describe('points captured', () => {
  it('is the share of the achievable points the top k actually got', () => {
    // Predicted order picks players scoring 10 and 1; the best two available scored 10 and 9.
    const predicted = [5, 4, 3];
    const actual = [10, 1, 9];
    expect(pointsCaptured(predicted, actual, 2)).toBeCloseTo(11 / 19, 9);
  });

  it('is 1 when the ranking is perfect, whatever the spread', () => {
    expect(pointsCaptured([3, 2, 1], [12, 5, 0], 2)).toBe(1);
  });

  it('is undefined when the true top k scored nothing — 0/0 is not 0', () => {
    expect(pointsCaptured([3, 2, 1], [0, 0, 0], 2)).toBeNull();
  });

  it('survives a tie at the boundary, where precision@k does not', () => {
    // Two players tied on 4 at the boundary of the true top 2. Which one "belongs" in the true set
    // depends on sort order — so precision moves for a reason that has nothing to do with the model,
    // while points captured is identical either way. This is why one is primary and one is not.
    const actual = [9, 4, 4];
    const takesSecond = pointsCaptured([3, 2, 1], actual, 2);
    const takesThird = pointsCaptured([3, 1, 2], actual, 2);
    expect(takesSecond).toBe(takesThird);
    expect(takesSecond).toBe(1);
  });
});

describe('precision@k', () => {
  it('counts overlap with the true top k', () => {
    expect(precisionAtK([3, 2, 1], [30, 20, 10], 2)).toBe(1);
    expect(precisionAtK([1, 2, 3], [30, 20, 10], 1)).toBe(0);
  });
});

describe('rounds are scored separately, then aggregated', () => {
  // Two rounds. Within each the model ranks perfectly; across them it is wrong about which round
  // was the high-scoring one. Pooled, that looks like a flawed ranking. Per round, it is perfect —
  // and per round is the only ranking a deadline ever asks for.
  const rows: PredictionRow[] = [
    row({
      round: 1,
      playerCode: 1,
      predicted: { model: 2, form: 0, priorSeason: 0, v4: null },
      actual: 2,
    }),
    row({
      round: 1,
      playerCode: 2,
      predicted: { model: 1, form: 0, priorSeason: 0, v4: null },
      actual: 1,
    }),
    row({
      round: 2,
      playerCode: 1,
      predicted: { model: 2, form: 0, priorSeason: 0, v4: null },
      actual: 20,
    }),
    row({
      round: 2,
      playerCode: 2,
      predicted: { model: 1, form: 0, priorSeason: 0, v4: null },
      actual: 10,
    }),
  ];

  it('reports a perfect within-round ranking as perfect', () => {
    const byRound = orderingByRound(rows, 'model', ORDERING_VIEWS[0], [2]);
    expect(byRound).toHaveLength(2);
    for (const r of byRound) expect(r.spearman).toBeCloseTo(1, 9);
    expect(summariseOrdering(byRound, [2]).meanSpearman).toBeCloseTo(1, 9);
  });

  it('drops a silent round from the mean instead of scoring it zero', () => {
    const withBlank = [
      ...rows,
      row({ round: 3, playerCode: 1, actual: 0 }),
      row({ round: 3, playerCode: 2, actual: 0 }),
    ];
    const summary = summariseOrdering(
      orderingByRound(withBlank, 'model', ORDERING_VIEWS[0], [2]),
      [2],
    );
    expect(summary.rounds).toBe(2);
    expect(summary.meanSpearman).toBeCloseTo(1, 9);
  });
});

describe('the sabotage: a shuffled ranking must collapse', () => {
  // A ranking metric that survives having its predictions shuffled is measuring the round rather
  // than the model. This is the check that makes every other number in the phase mean something.
  const field = Array.from({ length: 60 }, (_, i) =>
    row({
      playerCode: i + 1,
      // A realistic FPL shape: most players near zero, a few hauls, many ties.
      actual: i < 4 ? 12 - i : i < 12 ? 5 : i < 25 ? 2 : 0,
      predicted: { model: 60 - i, form: 0, priorSeason: 0, v4: null },
    }),
  );

  it('scores a perfect ranking near the top and a shuffled one far below it', () => {
    const honest = summariseOrdering(
      orderingByRound(field, 'model', ORDERING_VIEWS[0], [11]),
      [11],
    );

    const shuffledPredictions = seededShuffle(
      field.map((r) => r.predicted.model as number),
      12345,
    );
    const shuffled = summariseOrdering(
      orderingByRound(
        field.map((r, i) => ({
          ...r,
          predicted: { ...r.predicted, model: shuffledPredictions[i] },
        })),
        'model',
        ORDERING_VIEWS[0],
        [11],
      ),
      [11],
    );

    // 0.888, not 1 — and that is the tie correction working, not a defect. 35 of these 60 players
    // are tied on 2 or 0, so no ordering of them can be "right": the outcome carries no order to
    // recover. A perfect ranking is capped below 1 by the ties in the outcome itself, which is
    // exactly the ceiling an FPL gameweek has. An implementation that reported 1 here would be
    // claiming to have ordered players the data does not distinguish.
    expect(honest.meanSpearman!).toBeGreaterThan(0.85);
    expect(honest.meanSpearman!).toBeLessThan(1);
    expect(honest.meanPointsCaptured.get(11)!).toBe(1);

    expect(Math.abs(shuffled.meanSpearman!)).toBeLessThan(0.5);
    expect(shuffled.meanPointsCaptured.get(11)!).toBeLessThan(0.8);
  });

  it("caps a perfect ranking below 1 when the outcome is tied — the ceiling is the data's", () => {
    // Stated on its own so the number above is read as a ceiling rather than a shortfall. Perfect
    // prediction, three-way tie in the outcome: the best rho available is not 1.
    // By hand: predicted ranks [1,2,3,4], actual ranks [1,3,3,3] after tie-averaging.
    // Pearson over those is 3/sqrt(15) = 0.7746 — the ceiling, with a perfect prediction.
    const perfect = spearman([4, 3, 2, 1], [10, 2, 2, 2]);
    expect(perfect).toBeCloseTo(3 / Math.sqrt(15), 9);
    expect(perfect).toBeLessThan(1);
  });
});

describe('views narrow the field the way the optimiser does', () => {
  const field = Array.from({ length: 200 }, (_, i) =>
    row({
      playerCode: i + 1,
      value: 40 + i,
      predicted: { model: i, form: null, priorSeason: null, v4: null },
    }),
  );

  it('ranks the top 100 by price, not all 600', () => {
    const byRound = orderingByRound(field, 'model', ORDERING_VIEWS[1], [11]);
    expect(byRound[0].n).toBe(100);
  });

  it("ranks the predictor's own shortlist, which is what reaches a recommendation", () => {
    const byRound = orderingByRound(field, 'model', ORDERING_VIEWS[2], [11]);
    expect(byRound[0].n).toBe(100);
  });
});
