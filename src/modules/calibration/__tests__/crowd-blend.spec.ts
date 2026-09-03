import { applyCrowdBlend, PredictionRow } from '../harness';
import { predictionRow } from './prediction-row';

/**
 * The market blend (B-043, plan 029 task 3).
 *
 * Three invariants. Without a `crowd` block the predictor is absent — null, never the model in
 * disguise. The blend never moves the LEVEL of a round: `ep_next` is rescaled to the model's mean
 * first, so a horizon tail with no `ep_next` is not tilted against the near round. And a row with
 * no capture keeps the model alone, so the blend is defined wherever the model is.
 */

const rowWith = (
  playerCode: number,
  model: number,
  epNext: number | null,
): PredictionRow => ({
  ...predictionRow({ playerCode, round: 1 }),
  predicted: { model, form: null, priorSeason: null, v4: null, epNext, blend: null },
});

const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / xs.length;

describe('the ep_next blend', () => {
  it('is absent without a crowd block', () => {
    const rows = [rowWith(1, 4, 2), rowWith(2, 2, 4)];
    applyCrowdBlend(rows, undefined);
    expect(rows.map((r) => r.predicted.blend)).toEqual([null, null]);
  });

  it('is the model exactly at weight 0', () => {
    const rows = [rowWith(1, 4, 2), rowWith(2, 2, 4)];
    applyCrowdBlend(rows, { epNextWeight: 0 });
    expect(rows.map((r) => r.predicted.blend)).toEqual([4, 2]);
  });

  it('keeps the round at the model level and takes its order from ep_next at weight 1', () => {
    // Model says 4, 2, 1 (mean 7/3); ep_next says 1, 2, 4 on a lower level (mean 7/3 too, by
    // construction, so the scale is 1 here) — the blend must reverse the order and keep the mean.
    const rows = [rowWith(1, 4, 1), rowWith(2, 2, 2), rowWith(3, 1, 4)];
    applyCrowdBlend(rows, { epNextWeight: 1 });
    const blend = rows.map((r) => r.predicted.blend as number);
    expect(blend[2]).toBeGreaterThan(blend[0]);
    expect(mean(blend)).toBeCloseTo(mean([4, 2, 1]), 10);
  });

  it('rescales ep_next to the model level before mixing', () => {
    // ep_next sits at half the model's level. At weight 1 the blend is ep_next × 2, not ep_next.
    const rows = [rowWith(1, 4, 2), rowWith(2, 2, 1)];
    applyCrowdBlend(rows, { epNextWeight: 1 });
    expect(rows.map((r) => r.predicted.blend)).toEqual([4, 2]);
    applyCrowdBlend(rows, { epNextWeight: 0.5 });
    expect(rows.map((r) => r.predicted.blend)).toEqual([4, 2]);
  });

  it('falls back to the model on a row with no ep_next, and levels on the rows that have it', () => {
    const rows = [rowWith(1, 4, 2), rowWith(2, 2, 1), rowWith(3, 9, null)];
    applyCrowdBlend(rows, { epNextWeight: 0.5 });
    // The scale is taken from rows 1 and 2 alone (model 6 over ep 3 = 2), so row 3 is untouched
    // and rows 1 and 2 land on themselves.
    expect(rows.map((r) => r.predicted.blend)).toEqual([4, 2, 9]);
  });
});
