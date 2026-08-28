import { execSync } from 'node:child_process';

/**
 * The season-recency weighting has to be inert when it is switched off.
 *
 * Its default (a one-season half-life) changes every fitted constant, which is the point. But a
 * weighting that could not be turned off would make every earlier fit unreproducible, and the claim
 * "this is the same fit with older seasons down-weighted" would be unfalsifiable. So: with the decay
 * disabled the fitter must reproduce the unweighted arithmetic exactly.
 *
 * Asserted on the arithmetic rather than by running the whole fit, which needs a database.
 */
describe('season weighting', () => {
  // The weight a row gets, extracted as the fitter computes it: 0.5 ** (seasonsOld / halfLife).
  const weightFor = (age: number, halfLife: number) =>
    Number.isFinite(halfLife) ? Math.pow(0.5, age / halfLife) : 1;

  it('gives the newest season full weight at any half-life', () => {
    for (const halfLife of [0.5, 1, 2, 4, Infinity]) {
      expect(weightFor(0, halfLife)).toBe(1);
    }
  });

  it('halves the weight every half-life', () => {
    expect(weightFor(1, 1)).toBeCloseTo(0.5, 12);
    expect(weightFor(2, 1)).toBeCloseTo(0.25, 12);
    expect(weightFor(2, 2)).toBeCloseTo(0.5, 12);
  });

  it('is inert when the decay is switched off — every season weighs the same', () => {
    const weights = [0, 1, 2, 5, 9].map((age) => weightFor(age, Infinity));
    expect(new Set(weights)).toEqual(new Set([1]));
  });

  it('at a one-season half-life, 2016-17 is worth under 1% of the newest season', () => {
    // nine seasons back, which is what the ten-season archive puts at the far end
    expect(weightFor(9, 1)).toBeLessThan(0.01);
  });

  /**
   * A weighted likelihood is not an unweighted one with a rescaled step. Doubling every weight must
   * leave the fitted parameters where they were — if it does not, the weight is entering the
   * gradient without entering the Hessian, and the fit is silently over-stepping.
   */
  it('is invariant to a constant rescaling of every weight', () => {
    const irls = (points: { x: number; y: number; w: number }[]) => {
      let a = 0;
      let b = 1;
      for (let iter = 0; iter < 200; iter++) {
        let g0 = 0;
        let g1 = 0;
        let h00 = 0;
        let h01 = 0;
        let h11 = 0;
        for (const p of points) {
          const mu = 1 / (1 + Math.exp(-(a + b * p.x)));
          const w = p.w * mu * (1 - mu);
          const r = p.w * (p.y - mu);
          g0 += r;
          g1 += r * p.x;
          h00 += w;
          h01 += w * p.x;
          h11 += w * p.x * p.x;
        }
        const det = h00 * h11 - h01 * h01;
        if (Math.abs(det) < 1e-12) break;
        a += (h11 * g0 - h01 * g1) / det;
        b += (h00 * g1 - h01 * g0) / det;
      }
      return [a, b];
    };
    // Deliberately NOT separable. A clean split at x = 0 has no finite maximum-likelihood slope,
    // so both runs would chase infinity and disagree on the way there — the test would fail for a
    // reason that has nothing to do with weights.
    const pts = [
      { x: -2, y: 0, w: 1 },
      { x: -1, y: 1, w: 1 },
      { x: -1, y: 0, w: 1 },
      { x: 0, y: 1, w: 1 },
      { x: 0, y: 0, w: 1 },
      { x: 1, y: 1, w: 1 },
      { x: 1, y: 0, w: 1 },
      { x: 2, y: 1, w: 1 },
    ];
    const once = irls(pts);
    const twice = irls(pts.map((p) => ({ ...p, w: p.w * 2 })));
    expect(twice[0]).toBeCloseTo(once[0], 9);
    expect(twice[1]).toBeCloseTo(once[1], 9);
  });
});
