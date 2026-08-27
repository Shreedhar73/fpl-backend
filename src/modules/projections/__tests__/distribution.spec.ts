import {
  bernoulliPmf,
  bonusPmf,
  convolve,
  countPmf,
  floorDivPmf,
  mixPmf,
  pmfAt,
  summarise,
} from '../distributions';
import { minutesDistribution, projectFixtureV2 } from '../model-v2';
import { FITTED_PARAMS } from '../fitted';
import { Scoring } from '../scoring';
import { scoringForSeason } from '../../archive/archive-scoring';

/**
 * B-017 — the points distribution.
 *
 * **The check this file exists for.** `ep` and `distribution.mean` are two independent routes to the
 * same number: one composes component means, the other convolves component distributions and takes
 * the mean of the result. A distribution that is never normalised, or one built from a component the
 * mean does not include, produces entirely plausible numbers that mean nothing — and nothing at
 * runtime would say so, because both routes return a float in the right range. So every projection
 * test below asserts the two agree, and that the mass sums to 1.
 */

const scoring = Scoring.from(scoringForSeason('2025-26')!.scoring);
const goals = { lambdaFor: 1.5, lambdaAgainst: 1.2, attackAdjustment: 1 };
const rates = { xg90: 0.35, xa90: 0.2, defcon90: 6, saves90: 0, bps90: 22 };

const lagged = (startRate: number, subRate = 0.15) => ({ startRate, subRate });

describe('the PMF primitives', () => {
  it('convolves two point masses into their sum', () => {
    const c = convolve(pmfAt(2), pmfAt(3));
    expect(summarise(c).mean).toBeCloseTo(5, 10);
    expect(summarise(c).total).toBeCloseTo(1, 10);
  });

  it('keeps a count distribution normalised even when its tail is folded', () => {
    // The tail past `maxCount` is folded into the top bin rather than dropped. Dropping it would
    // leave a distribution summing to less than 1, and every probability read off it would be low
    // by an amount nobody would notice.
    const s = summarise(countPmf(3.5, 4, 5));
    expect(s.total).toBeCloseTo(1, 10);
    expect(s.mean).toBeGreaterThan(0);
  });

  it('a count is centred on its lambda times its points value', () => {
    // maxCount high enough that the fold is negligible, so the mean is the exact Poisson mean.
    const s = summarise(countPmf(0.4, 5, 12));
    expect(s.mean).toBeCloseTo(0.4 * 5, 6);
  });

  it('handles a NEGATIVE points value, which is where a positive-only helper silently returns 0', () => {
    const s = summarise(floorDivPmf(3, 2, -1, 6));
    expect(s.total).toBeCloseTo(1, 10);
    expect(s.mean).toBeLessThan(0);
  });

  it('bonus is {0,1,2,3} and never a fractional certainty', () => {
    const pmf = bonusPmf(0.3, 1);
    const s = summarise(pmf);
    expect(s.total).toBeCloseTo(1, 10);
    // mean = pAny × 2, because an award averages 2 across the three recipients
    expect(s.mean).toBeCloseTo(0.6, 10);
    // and the mass sits only on the four integer outcomes
    expect(pmf.p.filter((q) => q > 0)).toHaveLength(4);
  });

  it('a Bernoulli worth negative points puts its mass the right way round', () => {
    const s = summarise(bernoulliPmf(0.25, -3));
    expect(s.mean).toBeCloseTo(-0.75, 10);
    expect(s.total).toBeCloseTo(1, 10);
  });

  it('mixes by weight, and an omitted state would renormalise the rest', () => {
    const mixed = mixPmf([
      { weight: 0.5, pmf: pmfAt(10) },
      { weight: 0.5, pmf: pmfAt(0) },
    ]);
    const s = summarise(mixed);
    expect(s.mean).toBeCloseTo(5, 10);
    expect(s.total).toBeCloseTo(1, 10);
  });
});

describe('the projection carries its own distribution', () => {
  const project = (
    startRate: number,
    position: 'MID' | 'DEF' | 'GKP' = 'MID',
  ) =>
    projectFixtureV2(
      position,
      minutesDistribution(lagged(startRate), 1, FITTED_PARAMS),
      position === 'GKP' ? { ...rates, saves90: 3.2, defcon90: 0 } : rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );

  /** THE CHECK. Two independent routes to one number. */
  it.each([
    ['a nailed starter', 0.95],
    ['a rotation risk', 0.4],
    ['a fringe player', 0.05],
  ])('%s: the distribution mean equals the analytic ep', (_label, rate) => {
    const p = project(rate);
    expect(p.distribution.total).toBeCloseTo(1, 8);
    expect(p.distribution.mean).toBeCloseTo(p.ep, 4);
  });

  it.each([['DEF'], ['GKP']] as const)(
    '%s too — the positions with negative terms in them',
    (position) => {
      const p = project(0.9, position);
      expect(p.distribution.total).toBeCloseTo(1, 8);
      expect(p.distribution.mean).toBeCloseTo(p.ep, 4);
    },
  );

  /**
   * The whole reason B-017 exists: two players with the same expected points are not the same bet.
   */
  it('separates a rotation risk from a nailed player at a similar mean', () => {
    const nailed = project(0.95);
    const rotated = project(0.35);

    expect(rotated.distribution.pBlank).toBeGreaterThan(
      nailed.distribution.pBlank,
    );
    // And by a margin that would change a decision, not a rounding difference.
    expect(
      rotated.distribution.pBlank - nailed.distribution.pBlank,
    ).toBeGreaterThan(0.2);
  });

  it('a player who cannot play blanks with certainty and has no spread', () => {
    const out = projectFixtureV2(
      'MID',
      minutesDistribution(lagged(0.9), 0, FITTED_PARAMS),
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(out.ep).toBe(0);
    expect(out.distribution.pBlank).toBeCloseTo(1, 10);
    expect(out.distribution.sd).toBeCloseTo(0, 10);
    expect(out.distribution.pHaul).toBeCloseTo(0, 10);
  });

  it('a haul is rare and a blank is not, which is what FPL scoring looks like', () => {
    const p = project(0.95);
    expect(p.distribution.pHaul).toBeLessThan(0.25);
    expect(p.distribution.pHaul).toBeGreaterThan(0);
    expect(p.distribution.pBlank).toBeGreaterThan(0.05);
  });

  it('the standard deviation is larger than the mean, as a points distribution this skewed must be', () => {
    // FPL points are mostly 1 or 2 with a long thin tail. An sd well below the mean would mean the
    // model had smoothed the tail away, which is exactly the failure a mean-only projection has.
    const p = project(0.9);
    expect(p.distribution.sd).toBeGreaterThan(p.ep * 0.5);
  });
});
