import { minutesDistribution, projectFixtureV2 } from '../model-v2';
import { FITTED_PARAMS } from '../fitted';
import { Scoring } from '../scoring';
import { scoringForSeason } from '../../archive/archive-scoring';

/**
 * B-020 — the non-linear terms, integrated over the MINUTES and not only over the count.
 *
 * `distributions.ts` exists to enforce one rule: the expectation of a function is not the function of
 * the expectation. v2 applied it to the count and left it broken one argument earlier, on the minutes.
 *
 * The trap in testing this is a mixture that is mathematically different and numerically identical,
 * which happens whenever the two minutes states carry the same rate. So every assertion below is
 * made on a **rotation risk**, where the states are far apart, and compared against a nailed starter,
 * where they should nearly coincide. A test written on a nailed starter alone would pass against the
 * old code.
 */

const scoring = Scoring.from(scoringForSeason('2025-26')!.scoring);
const goals = { lambdaFor: 1.4, lambdaAgainst: 1.3, attackAdjustment: 1 };
const rates = { xg90: 0.05, xa90: 0.06, defcon90: 7.5, saves90: 0, bps90: 16 };

/** 30% to start: the two minutes states are 83 minutes apart, which is where Jensen bites. */
const rotation = minutesDistribution(
  { startRate: 0.3, subRate: 0.15 },
  1,
  FITTED_PARAMS,
);
const nailed = minutesDistribution(
  { startRate: 0.98, subRate: 0.15 },
  1,
  FITTED_PARAMS,
);

describe('defensive contribution over the minutes distribution', () => {
  it('a rotation risk keeps a real chance of clearing the threshold', () => {
    const p = projectFixtureV2(
      'DEF',
      rotation,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );

    // What the OLD shape did: one threshold probability at the averaged minute count. The mixture
    // must be strictly and substantially larger, because the threshold is convex in lambda.
    const ninetieths = rotation.expectedMinutes / 90;
    const pointEstimateLambda =
      rates.defcon90 * ninetieths * FITTED_PARAMS.defcon.ratePer90ToMatch;
    // λ ≈ 2.4 against a threshold of 10 — the old shape sent this to essentially zero.
    expect(pointEstimateLambda).toBeLessThan(4);
    expect(p.probabilities.defcon).toBeGreaterThan(0.02);
  });

  it('and a nailed starter is barely affected, because his states nearly coincide', () => {
    const p = projectFixtureV2(
      'DEF',
      nailed,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    // He plays 83 minutes almost always, so mixing over the states changes little. This is the
    // control: if THIS number had moved a lot, the change would be a rescaling rather than a fix.
    expect(p.probabilities.defcon).toBeGreaterThan(0.1);
    expect(p.probabilities.defcon).toBeLessThan(0.5);
  });

  it('scales with the probability of starting, not with a threshold on average minutes', () => {
    const probability = (startRate: number) =>
      projectFixtureV2(
        'DEF',
        minutesDistribution({ startRate, subRate: 0.15 }, 1, FITTED_PARAMS),
        rates,
        goals,
        scoring,
        FITTED_PARAMS,
      ).probabilities.defcon;

    const low = probability(0.2);
    const mid = probability(0.5);
    const high = probability(0.9);
    expect(mid).toBeGreaterThan(low);
    expect(high).toBeGreaterThan(mid);
    // Roughly proportional to P(start), which is what a per-match threshold actually is.
    expect(low).toBeGreaterThan(high * 0.1);
  });

  it('still pays a goalkeeper nothing — the position has no threshold', () => {
    const p = projectFixtureV2(
      'GKP',
      nailed,
      { ...rates, defcon90: 30 },
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(p.probabilities.defcon).toBe(0);
    expect(p.components.defensive_contribution).toBe(0);
  });
});

describe('goals conceded', () => {
  /**
   * `fpl-domain-rules`: only the CLEAN SHEET has a 60-minute gate. `−1 per 2 goals conceded` applies
   * to goals conceded while the player is on the pitch, at any minute count. The term used to
   * multiply by `pSixtyPlus`, which is a rule that does not exist.
   */
  it('charges a substitute defender who was never going to see the hour', () => {
    const subOnly = minutesDistribution(
      { startRate: 0.02, subRate: 0.9 },
      1,
      FITTED_PARAMS,
    );
    // 0.115, not 0.02: `startSlope` is 0.485, so even a player who has started 2% of his matches is
    // given an 11% chance of starting the next one. The point stands — most of his appearance
    // probability is the sub term, and the old code charged him for none of the goals he concedes.
    expect(subOnly.pSixtyPlus).toBeLessThan(0.15);
    expect(subOnly.pSub).toBeGreaterThan(0.5);
    expect(subOnly.pSub).toBeGreaterThan(subOnly.pSixtyPlus * 4);

    const p = projectFixtureV2(
      'DEF',
      subOnly,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(p.components.goals_conceded).toBeLessThan(0);
  });

  it('charges a full-match defender more than a substitute', () => {
    const starter = projectFixtureV2(
      'DEF',
      nailed,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    ).components.goals_conceded;
    const sub = projectFixtureV2(
      'DEF',
      minutesDistribution({ startRate: 0.02, subRate: 0.9 }, 1, FITTED_PARAMS),
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    ).components.goals_conceded;
    expect(starter).toBeLessThan(sub); // both negative; the starter is charged more
  });

  it('charges a midfielder nothing, whatever his minutes', () => {
    const p = projectFixtureV2(
      'MID',
      nailed,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(p.components.goals_conceded).toBe(0);
  });
});

describe('saves', () => {
  it('a rotation-risk keeper is paid more than the point estimate would allow', () => {
    const keeperRates = { ...rates, saves90: 3.2, defcon90: 0 };
    const rotationKeeper = projectFixtureV2(
      'GKP',
      rotation,
      keeperRates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    // `E[floor(S/3)]` is convex, so mixing over the states pays more than one evaluation at the
    // averaged rate. With saves90 3.2 and 30% of starts the point estimate is under half a save.
    expect(rotationKeeper.components.saves).toBeGreaterThan(0);

    const nailedKeeper = projectFixtureV2(
      'GKP',
      nailed,
      keeperRates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(nailedKeeper.components.saves).toBeGreaterThan(
      rotationKeeper.components.saves,
    );
  });

  it('pays an outfield player nothing however many saves the rate claims', () => {
    const p = projectFixtureV2(
      'MID',
      nailed,
      { ...rates, saves90: 5 },
      goals,
      scoring,
      FITTED_PARAMS,
    );
    expect(p.components.saves).toBe(0);
  });
});

describe('the mixture leaves the linear terms alone', () => {
  /**
   * Goals and assists are LINEAR in minutes, so `E[f(minutes)] = f(E[minutes])` holds exactly for
   * them and the mixture must not change them. If this moved, the change would have leaked into
   * terms it has no business touching.
   */
  it('expected goals and assists still scale with expected minutes', () => {
    const p = projectFixtureV2(
      'MID',
      rotation,
      { ...rates, xg90: 0.4, xa90: 0.3 },
      goals,
      scoring,
      FITTED_PARAMS,
    );
    const ninetieths = rotation.expectedMinutes / 90;
    expect(p.expected.goals).toBeCloseTo(
      ninetieths * 0.4 * FITTED_PARAMS.attack.goalsPerXg,
      10,
    );
    expect(p.expected.assists).toBeCloseTo(
      ninetieths * 0.3 * FITTED_PARAMS.attack.assistsPerXa,
      10,
    );
  });
});
