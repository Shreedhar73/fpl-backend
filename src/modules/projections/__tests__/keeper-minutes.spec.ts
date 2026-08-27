import { minutesDistribution } from '../model-v2';
import { FITTED_PARAMS, UNFITTED_PARAMS, FittedParams } from '../fitted';

/**
 * B-021 — the keeper curves apply to keepers alone, and their absence degrades to the global
 * behaviour rather than to anything new.
 */
describe('keeper-specific minutes curves', () => {
  const withGkp: FittedParams = {
    ...FITTED_PARAMS,
    minutes: {
      ...FITTED_PARAMS.minutes,
      gkp: {
        startIntercept: -2,
        startSlope: 1.5,
        // a benched keeper does not come on: a curve pinned hard low
        subIntercept: -5,
        subSlope: 0.2,
        n: { start: 3000, sub: 2000 },
      },
    },
  };
  const lagged = { startRate: 0.5, subRate: 0.2 };

  it('a keeper is scored on the keeper curves', () => {
    const gk = minutesDistribution(lagged, 1, withGkp, 'GKP');
    const global = minutesDistribution(lagged, 1, withGkp, 'MID');
    expect(gk.pStart).not.toBeCloseTo(global.pStart, 6);
    expect(gk.pSub).toBeLessThan(global.pSub);
  });

  it('every other position is untouched by the keeper block', () => {
    for (const pos of ['DEF', 'MID', 'FWD', undefined]) {
      const withBlock = minutesDistribution(lagged, 1, withGkp, pos);
      const without = minutesDistribution(
        lagged,
        1,
        { ...withGkp, minutes: { ...withGkp.minutes, gkp: undefined } },
        pos,
      );
      expect(withBlock).toEqual(without);
    }
  });

  it('params without the block score keepers on the global curves — old fits keep working', () => {
    const gk = minutesDistribution(lagged, 1, UNFITTED_PARAMS, 'GKP');
    const mid = minutesDistribution(lagged, 1, UNFITTED_PARAMS, 'MID');
    expect(gk).toEqual(mid);
  });

  it('a benched second-choice keeper is finally cheap', () => {
    // near-zero lagged sub rate: the pinned-low keeper sub curve must price the cameo far below
    // the global curve does — this is the 0.353-vs-0.225 gap B-013 measured, closing
    const fringe = { startRate: 0.02, subRate: 0.02 };
    const gk = minutesDistribution(fringe, 1, withGkp, 'GKP');
    const global = minutesDistribution(fringe, 1, withGkp, 'MID');
    expect(gk.pSub).toBeLessThan(global.pSub / 2);
  });
});
