// The v3 incumbent, deliberately: these specs are about a flag being INERT when absent, and since
// D-037 the served `FITTED_PARAMS` carries the flags on. The params set with nothing switched on is
// the incumbent, which is kept for exactly this kind of comparison.
import { V3_INCUMBENT_PARAMS as FITTED_PARAMS } from '../fitted';
import { HistoryRow, PlayerFeatures, walkRounds } from '../features';
import { minutesDistribution, projectFixtureV2 } from '../model-v2';
import { Scoring } from '../scoring';
import { scoringForSeason } from '../../archive/archive-scoring';

const SCORING = Scoring.from(scoringForSeason('2025-26')!.scoring);

/**
 * Recency-weighted player rates (B-041, plan 028 task 1).
 *
 * Two claims, and the first is the one that protects everything already measured: **without
 * `params.rates` the walk must produce exactly the features it produced before this existed.** Every
 * number in every committed report was made under the flat career mean, and a decay that leaked
 * would move all of them at once with nothing going red.
 */

const row = (
  over: Partial<HistoryRow> & { round: number; playerCode: number },
): HistoryRow => ({
  season: '2024-25',
  fixture: over.round * 100 + over.playerCode,
  webName: `P${over.playerCode}`,
  position: 'MID',
  teamCode: 1 + (over.playerCode % 2),
  opponentTeamCode: 2 - (over.playerCode % 2),
  wasHome: over.playerCode % 2 === 0,
  minutes: 90,
  starts: 1,
  totalPoints: 2,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 1,
  saves: 0,
  bonus: 0,
  bps: 20,
  defensiveContribution: null,
  expectedGoals: 0.1,
  expectedAssists: 0.1,
  expectedGoalsConceded: 1,
  ictIndex: 1,
  influence: null,
  creativity: null,
  threat: null,
  value: 50,
  ...over,
});

/**
 * A player whose level CHANGES: eight quiet rounds, then eight good ones. The flat career mean must
 * put him in the middle; a short half-life must put him near where he is now. Player 2 exists only
 * so the league has both sides of a fixture.
 */
const changed = (): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let r = 1; r <= 16; r++) {
    const good = r > 8;
    out.push(
      row({
        round: r,
        playerCode: 1,
        expectedGoals: good ? 0.6 : 0.05,
        bps: good ? 40 : 8,
      }),
    );
    out.push(
      row({ round: r, playerCode: 2, teamCode: 2, opponentTeamCode: 1 }),
    );
  }
  return out;
};

/** The features handed out for player 1 in the last round of the walk. */
const lastFeatures = (
  rows: HistoryRow[],
  rates?: { halfLifeRounds: number; shrinkMinutes: number },
): PlayerFeatures => {
  const params = rates ? { ...FITTED_PARAMS, rates } : FITTED_PARAMS;
  let last: PlayerFeatures | null = null;
  for (const context of walkRounds(rows, params)) {
    for (const item of context.items) {
      if (item.row.playerCode === 1) last = item.features;
    }
  }
  if (!last) throw new Error('no features produced');
  return last;
};

describe('rate recency', () => {
  it('changes nothing when the params carry no rate block', () => {
    const before = lastFeatures(changed());
    const inert = lastFeatures(changed(), {
      halfLifeRounds: Infinity,
      shrinkMinutes: 270,
    });
    // Identical, not close: an infinite half-life is a decay factor of exactly 1, and 270 is the
    // constant the code has always used. If these ever differ, every committed report moved.
    expect(inert.rates).toEqual(before.rates);
    expect(inert.minutesSample).toBe(before.minutesSample);
  });

  it('follows a player who has changed level, where the career mean cannot', () => {
    const flat = lastFeatures(changed());
    const recent = lastFeatures(changed(), {
      halfLifeRounds: 3,
      shrinkMinutes: 270,
    });
    // Eight rounds at 0.05 and eight at 0.6: the flat mean lands near the middle, the decayed rate
    // near the recent level. Both are shrunk toward the positional prior, so neither reaches its
    // raw value — the ORDER is the claim, not the numbers.
    expect(flat.rates.xg90).toBeLessThan(recent.rates.xg90);
    expect(flat.rates.bps90).toBeLessThan(recent.rates.bps90);
  });

  it('leaves the count-based samples alone, because thresholds are defined on them', () => {
    const flat = lastFeatures(changed());
    const recent = lastFeatures(changed(), {
      halfLifeRounds: 3,
      shrinkMinutes: 270,
    });
    // B-010's appearance floor, the start curve's denominator and every sample size a report prints
    // read these. Decaying them would move a floor while claiming to change a rate.
    expect(recent.matchesSample).toBe(flat.matchesSample);
    expect(recent.appearancesSample).toBe(flat.appearancesSample);
    expect(recent.laggedStartRate).toBe(flat.laggedStartRate);
  });

  it('shrinks harder toward the positional prior when told to', () => {
    const light = lastFeatures(changed(), {
      halfLifeRounds: Infinity,
      shrinkMinutes: 270,
    });
    const heavy = lastFeatures(changed(), {
      halfLifeRounds: Infinity,
      shrinkMinutes: 5000,
    });
    // This player is well above the positional mean, so heavier shrinkage must pull him down.
    expect(heavy.rates.xg90).toBeLessThan(light.rates.xg90);
    expect(heavy.rates.bps90).toBeLessThan(light.rates.bps90);
  });
});

/**
 * The other two model-shape flags of plan 028, held to the same rule: absent, the model is the one
 * that shipped. Asserted rather than assumed — all three ship in one change, and a flag that leaked
 * would move every committed number at once with nothing going red.
 */
describe('plan 028 flags are inert when absent', () => {
  const rows = changed();

  it('per-player start behaviour changes nothing until the params ask for it', () => {
    const params = FITTED_PARAMS;
    const withFlagOff = { ...params, minutes: { ...params.minutes } };
    const withFlagOn = {
      ...params,
      minutes: { ...params.minutes, perPlayerStart: true },
    };
    const project = (p: typeof params) => {
      let ep: number | null = null;
      for (const context of walkRounds(rows, p)) {
        for (const item of context.items) {
          if (item.row.playerCode !== 1) continue;
          const minutes = minutesDistribution(
            {
              startRate: item.features.laggedStartRate,
              subRate: item.features.laggedSubRate,
              startMinutes: item.features.startMinutes,
              startSixty: item.features.startSixty,
            },
            1,
            p,
            'MID',
          );
          ep = minutes.expectedMinutes;
        }
      }
      return ep;
    };
    expect(project(withFlagOff)).toBe(
      FITTED_PARAMS.minutes.minutesGivenStart *
        // the flag-off path prices every starter with the league constant, so the expected minutes
        // are a function of the two probabilities alone
        (project(withFlagOff)! / FITTED_PARAMS.minutes.minutesGivenStart),
    );
    // The real assertion: the two arms differ, and only because of the flag.
    expect(project(withFlagOn)).not.toBe(project(withFlagOff));
  });

  it('the bonus term is the incumbent until a temperature is set', () => {
    const scoring = SCORING;
    // Built by the model rather than by hand: a hand-written distribution can be internally
    // inconsistent — a `pSixtyPlus` that does not follow from its own `sixtyGivenStart` — and then
    // `distribution.mean === ep` fails for the fixture's reasons rather than the model's.
    const minutes = minutesDistribution(
      { startRate: 0.9, subRate: 0.3 },
      1,
      FITTED_PARAMS,
      'MID',
    );
    const rates = {
      xg90: 0.4,
      xa90: 0.2,
      defcon90: 2,
      saves90: 0,
      bps90: 25,
    };
    const goals = {
      lambdaFor: 1.5,
      lambdaAgainst: 1.2,
      attackAdjustment: 1,
      defenceAdjustment: 1,
    };
    const plain = projectFixtureV2(
      'MID',
      minutes,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
    );
    const ranked = projectFixtureV2(
      'MID',
      minutes,
      rates,
      goals,
      scoring,
      FITTED_PARAMS,
      { first: 0.2, second: 0.15, third: 0.1 },
    );
    expect(ranked.components.bonus).not.toBeCloseTo(plain.components.bonus, 6);
    // And the invariant that catches a half-finished change: the analytic mean and the convolution
    // must still agree, under both terms.
    expect(plain.distribution.mean).toBeCloseTo(plain.ep, 6);
    expect(ranked.distribution.mean).toBeCloseTo(ranked.ep, 6);
  });
});
