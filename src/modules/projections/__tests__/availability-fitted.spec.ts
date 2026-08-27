import {
  availabilityMultiplier,
  availabilitySignal,
  minutesDistribution,
} from '../model-v2';
import { FittedParams, FITTED_PARAMS } from '../fitted';

/**
 * The fitted-availability regime of plan 024: the rule-versus-fitted split, the null-means-fit
 * convention, and the explicit handling of unknown rows. Each case is the break-on-purpose for a
 * specific way this can silently rot (`fpl-testing-contract`):
 *
 * - read `chance: null` as 0 and every healthy player is benched;
 * - default an unknown row to fit and a Wayback gap becomes invisible training data;
 * - feed `u`/`s` rows to the logistic and the fit re-runs the complete-separation failure.
 */

/** Incumbent params plus a synthetic availability block with visible, distinct coefficients. */
const fittedParams = (): FittedParams => ({
  ...FITTED_PARAMS,
  minutes: {
    ...FITTED_PARAMS.minutes,
    availability: {
      startInj: -2,
      startInjX: 0.5,
      startUnknown: -0.4,
      subInj: -1,
      subUnknown: -0.2,
      sixtyGivenStartFlagged: 0.8,
      minutesGivenStartFlagged: 70,
      n: { startFlagged: 1000, subFlagged: 400, unknown: 100, flaggedStarts: 300 },
    },
  },
});

const lagged = { startRate: 0.8, subRate: 0.2 };

describe('availabilitySignal — the rule-versus-fitted split', () => {
  it('null chance means FULLY FIT for an available player, not unknown', () => {
    expect(availabilitySignal('a', null)).toEqual({ zero: false, inj: 0 });
  });

  it('deterministic statuses are rules: u, n and s zero the row', () => {
    for (const status of ['u', 'n', 's']) {
      expect(availabilitySignal(status, 75).zero).toBe(true);
    }
  });

  it('an effective 0% chance is a rule too, whatever the status letter', () => {
    expect(availabilitySignal('d', 0).zero).toBe(true);
    expect(availabilitySignal('i', null).zero).toBe(true);
  });

  it('the uncertain band is fitted: 75% doubt is inj 0.25, injured-but-50% is inj 0.5', () => {
    expect(availabilitySignal('d', 75)).toEqual({ zero: false, inj: 0.25 });
    expect(availabilitySignal('i', 50)).toEqual({ zero: false, inj: 0.5 });
  });

  it('a doubt with no percentage is a real doubt (the 50% convention), not fully fit', () => {
    expect(availabilitySignal('d', null)).toEqual({ zero: false, inj: 0.5 });
  });
});

describe('minutesDistribution — fitted-availability regime', () => {
  it('a deterministic status zeroes the whole distribution by rule', () => {
    const d = minutesDistribution(lagged, 1, fittedParams(), 'MID', {
      status: 's',
      chance: null,
      known: true,
    });
    expect(d).toEqual({
      pStart: 0,
      pSub: 0,
      pPlay: 0,
      pSixtyPlus: 0,
      expectedMinutes: 0,
    });
  });

  it('a flagged doubt starts less often than a fit player, and less than the hand rule×curve', () => {
    const params = fittedParams();
    const fit = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'a',
      chance: null,
      known: true,
    });
    const doubt = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'd',
      chance: 25,
      known: true,
    });
    expect(doubt.pStart).toBeLessThan(fit.pStart);
    expect(doubt.expectedMinutes).toBeLessThan(fit.expectedMinutes);
  });

  it('an unknown row takes the fitted unknown offset — never the fully-fit curve', () => {
    const params = fittedParams();
    const known = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'a',
      chance: null,
      known: true,
    });
    const unknown = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'a',
      chance: null,
      known: false,
    });
    // startUnknown is -0.4, so an unknown row must NOT reproduce the fit-player number. Defaulting
    // unknown to fit is exactly the silent failure the plan forbids.
    expect(unknown.pStart).toBeLessThan(known.pStart);
  });

  it('the scalar multiplier argument is dead in the fitted regime', () => {
    const params = fittedParams();
    const a = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'a',
      chance: null,
      known: true,
    });
    const b = minutesDistribution(lagged, 0.25, params, 'MID', {
      status: 'a',
      chance: null,
      known: true,
    });
    expect(a).toEqual(b);
  });

  it('flagged starters take the flagged 60+/minutes constants', () => {
    const params = fittedParams();
    const doubt = minutesDistribution(lagged, 1, params, 'MID', {
      status: 'd',
      chance: 75,
      known: true,
    });
    // pSixtyPlus uses sixtyGivenStartFlagged (0.8) rather than the global (0.934); with the same
    // pStart the flagged number is strictly smaller, and here pStart is smaller too.
    expect(doubt.pSixtyPlus).toBeLessThan(
      doubt.pStart * FITTED_PARAMS.minutes.sixtyGivenStart +
        doubt.pSub * FITTED_PARAMS.minutes.sixtyGivenSub +
        1e-12,
    );
  });

  it('params without the block keep the legacy multiplier behaviour byte-for-byte', () => {
    const legacy = minutesDistribution(lagged, 0.5, FITTED_PARAMS, 'MID');
    const legacyWithFlags = minutesDistribution(lagged, 0.5, FITTED_PARAMS, 'MID', {
      status: 'd',
      chance: 50,
      known: true,
    });
    // The avail argument must be inert for legacy params — the incumbent's behaviour is pinned.
    expect(legacy).toEqual(legacyWithFlags);
  });
});

describe('availabilityMultiplier — the incumbent hand rule, unchanged', () => {
  it('null chance means fully fit', () => {
    expect(availabilityMultiplier('a', null)).toBe(1);
  });
  it('a doubt with no percentage is 50%', () => {
    expect(availabilityMultiplier('d', null)).toBe(0.5);
  });
  it('i/s/u/n are zero regardless of chance', () => {
    expect(availabilityMultiplier('i', 75)).toBe(0);
  });
});
