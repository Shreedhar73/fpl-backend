import { BONUS_CANDIDATE_CAP, fixtureBonus } from '../bonus-rank';
import { bonusRankPmf } from '../distributions';

/**
 * Bonus as a rank inside the fixture (B-041, plan 028 task 4).
 *
 * The property that makes this worth building is arithmetic, not statistical: **a fixture has six
 * bonus points and the model must hand out six**. The incumbent term hands out 8.15–8.72 on average
 * and up to 16.56 in a single match, because it reads one player's BPS and nothing else.
 */

const player = (key: number, expectedBps: number, pPlay = 1) => ({
  key,
  pPlay,
  expectedBps,
});

/** A plausible match: two keepers, twenty outfielders, a spread of BPS. */
const fixture = (pPlay = 1) =>
  Array.from({ length: 22 }, (_, i) => player(i + 1, 40 - 1.5 * i, pPlay));

describe('fixtureBonus', () => {
  it('hands out exactly six points per fixture, which is the whole point', () => {
    const out = fixtureBonus(fixture(), 8);
    // 3 + 2 + 1. Nothing about the players can change this; that is what makes it a rank model.
    expect(out.totalExpected).toBeCloseTo(6, 6);
  });

  it('still hands out six when half the field might not play', () => {
    const out = fixtureBonus(fixture(0.5), 8);
    // Everybody's chance of featuring is halved, so nobody's is — the awards are still given out,
    // just more evenly. A model that paid out 3 here would be pricing a match nobody played in.
    expect(out.totalExpected).toBeCloseTo(6, 6);
  });

  it('gives the best player the largest share, and orders the rest behind him', () => {
    const out = fixtureBonus(fixture(), 8);
    const best = out.ranks.get(1)!;
    const second = out.ranks.get(2)!;
    const worst = out.ranks.get(22)!;
    expect(best.expected).toBeGreaterThan(second.expected);
    expect(second.expected).toBeGreaterThan(worst.expected);
    expect(best.first).toBeGreaterThan(best.third);
  });

  /**
   * The parameter, and what it means. It is chosen on validation, so the test is about the SHAPE of
   * its effect rather than about a value.
   */
  it('τ moves the field between a lottery and a certainty', () => {
    const sharp = fixtureBonus(fixture(), 0.3).ranks.get(1)!;
    const flat = fixtureBonus(fixture(), 100).ranks.get(1)!;
    expect(sharp.first).toBeGreaterThan(0.9);
    expect(flat.first).toBeLessThan(0.2);
    // Six points either way — the temperature moves who gets them, never how many there are.
    expect(fixtureBonus(fixture(), 0.3).totalExpected).toBeCloseTo(6, 6);
    expect(fixtureBonus(fixture(), 100).totalExpected).toBeCloseTo(6, 6);
  });

  it('takes bonus off a player when a teammate is added, because they compete', () => {
    const alone = fixtureBonus(
      [player(1, 40), ...fixture().slice(2)],
      8,
    ).ranks.get(1)!;
    const withRival = fixtureBonus(
      [player(1, 40), player(99, 40), ...fixture().slice(2)],
      8,
    ).ranks.get(1)!;
    // This is the error the incumbent cannot express: two teammates who both play well take the
    // bonus from each other, and a per-player term pays both of them in full.
    expect(withRival.expected).toBeLessThan(alone.expected);
  });

  it('does not truncate a fixture that fits under the cap', () => {
    const out = fixtureBonus(fixture(), 8);
    expect(out.truncatedMass).toBe(0);
    expect(out.ranks.size).toBe(22);
  });

  /**
   * An archive fixture carries every named player, unused substitutes included — fifty to sixty
   * rows, not twenty-two. Measured over 1,140 real fixtures at a cap of forty and no renormalisation
   * the model issued 5.691 points; the harness guard caught it. Renormalising redistributes the tail
   * rather than dropping it, so the six survives the cap.
   */
  it('still pays exactly six when the field is larger than the cap', () => {
    const many = Array.from({ length: BONUS_CANDIDATE_CAP + 35 }, (_, i) =>
      player(i + 1, 40 - 0.5 * i),
    );
    const out = fixtureBonus(many, 10);
    expect(out.ranks.size).toBe(BONUS_CANDIDATE_CAP);
    expect(out.truncatedMass).toBeGreaterThan(0);
    expect(out.totalExpected).toBeCloseTo(6, 6);
  });

  it('returns nothing for a fixture nobody plays in, rather than dividing by zero', () => {
    const out = fixtureBonus(fixture(0), 8);
    expect(out.ranks.size).toBe(0);
    expect(out.totalExpected).toBe(0);
  });
});

describe('bonusRankPmf', () => {
  it('has exactly the mean the analytic term uses', () => {
    const pmf = bonusRankPmf(0.3, 0.2, 0.1, 1);
    const mean = pmf.p.reduce((t, p, i) => t + p * (pmf.min + i), 0);
    // 3(0.3) + 2(0.2) + 1(0.1). If this drifts, `distribution.mean === ep` goes red — which is the
    // test doing its job, not a nuisance.
    expect(mean).toBeCloseTo(1.4, 12);
    expect(pmf.p.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 12);
  });

  it('puts a leader on three points rather than splitting his chance evenly', () => {
    const pmf = bonusRankPmf(0.6, 0.1, 0.05, 1);
    expect(pmf.p[3]).toBeCloseTo(0.6, 12);
    expect(pmf.p[1]).toBeCloseTo(0.05, 12);
    // The incumbent's `bonusPmf` splits P(any) evenly across 3/2/1, which understates exactly this
    // player's upside and overstates his floor.
  });
});
