import { predictionRow } from './prediction-row';
import { categoryRmse, returnCategory, v4Bar } from '../v4-verdict';

describe('returnCategory', () => {
  it('classifies by minutes first, then points', () => {
    expect(returnCategory({ minutes: 0, actual: 0 })).toBe('Zeros');
    // 0 minutes with points still Zeros — the category is about playing, not scoring
    expect(returnCategory({ minutes: 0, actual: 1 })).toBe('Zeros');
    expect(returnCategory({ minutes: 30, actual: 1 })).toBe('Blanks');
    expect(returnCategory({ minutes: 90, actual: 2 })).toBe('Blanks');
    expect(returnCategory({ minutes: 90, actual: 3 })).toBe('Tickers');
    expect(returnCategory({ minutes: 90, actual: 4 })).toBe('Tickers');
    expect(returnCategory({ minutes: 90, actual: 5 })).toBe('Haulers');
    expect(returnCategory({ minutes: 90, actual: 17 })).toBe('Haulers');
  });
});

describe('categoryRmse', () => {
  it('scores only rows every named predictor produced a number for', () => {
    const rows = [
      predictionRow({
        minutes: 90,
        actual: 6,
        predicted: { model: 5, form: 4, priorSeason: 0, v4: 7 },
      }),
      predictionRow({
        minutes: 90,
        actual: 6,
        predicted: { model: 5, form: 4, priorSeason: 0, v4: null },
      }),
    ];
    const out = categoryRmse(rows, ['model', 'v4']);
    const haulers = out.find((c) => c.category === 'Haulers')!;
    expect(haulers.n).toBe(1); // the v4-null row is dropped for BOTH predictors
    expect(haulers.rmse.model).toBe(1);
    expect(haulers.rmse.v4).toBe(1);
  });
});

describe('categoryRmse pairing', () => {
  const row = (round: number, actual: number, v4: number, model: number) =>
    predictionRow({
      round,
      minutes: 90,
      actual,
      predicted: { model, form: 0, priorSeason: 0, v4 },
    });

  it('pairs squared-error differences by round', () => {
    // v4 exactly right every round, incumbent off by 2: Δse = -4 every round, zero spread.
    const rows = [1, 2, 3, 4].map((r) => row(r, 6, 6, 8));
    const haulers = categoryRmse(rows, ['model', 'v4']).find(
      (c) => c.category === 'Haulers',
    )!;
    expect(haulers.paired).toBeDefined();
    expect(haulers.paired!.rounds).toBe(4);
    expect(haulers.paired!.meanSeDifference).toBeCloseTo(-4, 10);
    expect(haulers.paired!.standardError).toBeCloseTo(0, 10);
    expect(haulers.paired!.clearsNoise).toBe(true);
  });

  it('a sign-flipping difference does not clear', () => {
    const rows = [
      row(1, 6, 6, 8),
      row(2, 6, 8, 6),
      row(3, 6, 6, 8),
      row(4, 6, 8, 6),
    ];
    const haulers = categoryRmse(rows, ['model', 'v4']).find(
      (c) => c.category === 'Haulers',
    )!;
    expect(haulers.paired!.clearsNoise).toBe(false);
  });

  it('no pairing is emitted when v4 is not among the predictors', () => {
    const rows = [1, 2, 3].map((r) => row(r, 6, 6, 8));
    const haulers = categoryRmse(rows, ['model', 'form']).find(
      (c) => c.category === 'Haulers',
    )!;
    expect(haulers.paired).toBeUndefined();
  });
});

describe('v4Bar', () => {
  const cats = (over: Partial<Record<string, { v4: number; model: number }>>) =>
    (['Zeros', 'Blanks', 'Tickers', 'Haulers'] as const).map((category) => ({
      category,
      n: 100,
      rmse: {
        v4: over[category]?.v4 ?? 1.0,
        model: over[category]?.model ?? 1.1,
      },
    }));
  const captured = (win: boolean) =>
    [11, 15, 30].map((k) => ({
      k,
      v4: win ? 0.4 : 0.3,
      model: 0.35,
    }));

  it('met only when all three legs hold', () => {
    expect(v4Bar({ captured: captured(true), categories: cats({}) }).met).toBe(
      true,
    );
  });

  it('ordering must win at EVERY k, not most', () => {
    const c = captured(true);
    c[2].v4 = 0.34; // loses @30
    const v = v4Bar({ captured: c, categories: cats({}) });
    expect(v.orderingMet).toBe(false);
    expect(v.met).toBe(false);
    expect(v.lines.join('\n')).toContain('not met');
  });

  it('a Haulers regression fails the high-return leg', () => {
    const v = v4Bar({
      captured: captured(true),
      categories: cats({ Haulers: { v4: 1.2, model: 1.1 } }),
    });
    expect(v.highReturnMet).toBe(false);
    expect(v.met).toBe(false);
  });

  it('a >5% Zeros degradation fails the low-return leg even when everything else wins', () => {
    const v = v4Bar({
      captured: captured(true),
      categories: cats({ Zeros: { v4: 1.2, model: 1.1 } }),
    });
    expect(v.lowReturnHeld).toBe(false);
    expect(v.met).toBe(false);
  });

  it('a <=5% Zeros drift is tolerated, as the bar states', () => {
    const v = v4Bar({
      captured: captured(true),
      categories: cats({ Zeros: { v4: 1.14, model: 1.1 } }),
    });
    expect(v.lowReturnHeld).toBe(true);
  });

  // The B-030 lesson applied here from day one: the verdict prose must be a function of the run.
  it('an unresolved high-return miss is said to be unresolved', () => {
    const v = v4Bar({
      captured: captured(true),
      categories: [
        { category: 'Zeros', n: 100, rmse: { v4: 1.0, model: 1.1 } },
        { category: 'Blanks', n: 100, rmse: { v4: 1.0, model: 1.1 } },
        {
          category: 'Tickers',
          n: 100,
          rmse: { v4: 1.2, model: 1.1 },
          paired: {
            rounds: 37,
            meanSeDifference: 0.1,
            standardError: 0.2,
            clearsNoise: false,
          },
        },
        {
          category: 'Haulers',
          n: 100,
          rmse: { v4: 1.11, model: 1.1 },
          paired: {
            rounds: 37,
            meanSeDifference: 0.01,
            standardError: 0.2,
            clearsNoise: false,
          },
        },
      ],
    });
    expect(v.met).toBe(false);
    expect(v.lines.join('\n')).toContain('unresolved at this sample');
  });

  it('a high-return miss that CLEARS noise is not called unresolved', () => {
    const v = v4Bar({
      captured: captured(true),
      categories: [
        { category: 'Zeros', n: 100, rmse: { v4: 1.0, model: 1.1 } },
        { category: 'Blanks', n: 100, rmse: { v4: 1.0, model: 1.1 } },
        {
          category: 'Tickers',
          n: 100,
          rmse: { v4: 1.4, model: 1.1 },
          paired: {
            rounds: 37,
            meanSeDifference: 0.8,
            standardError: 0.1,
            clearsNoise: true,
          },
        },
        { category: 'Haulers', n: 100, rmse: { v4: 1.0, model: 1.1 } },
      ],
    });
    expect(v.met).toBe(false);
    expect(v.lines.join('\n')).not.toContain('unresolved at this sample');
  });

  it('the prose differs between a met and an unmet bar', () => {
    const met = v4Bar({ captured: captured(true), categories: cats({}) });
    const missed = v4Bar({ captured: captured(false), categories: cats({}) });
    expect(met.lines.join('\n')).not.toEqual(missed.lines.join('\n'));
    expect(met.lines.join('\n')).toContain('does not ship, however it measures');
    expect(missed.lines.join('\n')).toContain('`modelVersion` does not move');
  });
});
