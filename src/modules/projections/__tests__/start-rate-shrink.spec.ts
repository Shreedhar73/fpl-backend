import { FITTED_PARAMS, FittedParams } from '../fitted';
import { HistoryRow, PlayerFeatures, walkRounds } from '../features';

/**
 * The shrunk season start rate (B-042, plan 029 task 5).
 *
 * The incumbent's `laggedStartRate` is the season's own rate the moment the season has one match:
 * one substitute appearance and a career starter is rated 0, one start and a career substitute is
 * rated 1. `minutes.startRateShrink` blends the season toward the career rate with a pseudo-count;
 * absent or 0 it must be the step function it always was.
 */

const row = (
  over: Partial<HistoryRow> & { season: string; round: number; playerCode: number },
): HistoryRow => ({
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
 * Player 1 started all ten matches of 2024-25 and came off the bench in round 1 of 2025-26; what is
 * he rated at round 2? Player 2 is the other side of every fixture.
 */
const rows = (): HistoryRow[] => {
  const out: HistoryRow[] = [];
  for (let r = 1; r <= 10; r++) {
    out.push(row({ season: '2024-25', round: r, playerCode: 1 }));
    out.push(row({ season: '2024-25', round: r, playerCode: 2 }));
  }
  out.push(row({ season: '2025-26', round: 1, playerCode: 1, starts: 0, minutes: 20 }));
  out.push(row({ season: '2025-26', round: 1, playerCode: 2 }));
  out.push(row({ season: '2025-26', round: 2, playerCode: 1 }));
  out.push(row({ season: '2025-26', round: 2, playerCode: 2 }));
  return out;
};

const featuresAtRoundTwo = (params: FittedParams): PlayerFeatures => {
  for (const context of walkRounds(rows(), params)) {
    if (context.season !== '2025-26' || context.round !== 2) continue;
    const item = context.items.find((i) => i.row.playerCode === 1);
    if (item) return item.features;
  }
  throw new Error('no features at round 2');
};

const withShrink = (k: number): FittedParams => ({
  ...FITTED_PARAMS,
  minutes: { ...FITTED_PARAMS.minutes, startRateShrink: k },
});

describe('the shrunk season start rate', () => {
  it('is the season step when the params carry no shrink, or a shrink of 0', () => {
    expect(featuresAtRoundTwo(FITTED_PARAMS).laggedStartRate).toBe(0);
    expect(featuresAtRoundTwo(withShrink(0)).laggedStartRate).toBe(0);
  });

  it('moves one match into a season by a fraction of the way from career to observed', () => {
    // Career rate 1 (ten starts in ten), season 0 of 1. With k = 4: (0 + 4 × 1) / (1 + 4) = 0.8.
    expect(featuresAtRoundTwo(withShrink(4)).laggedStartRate).toBeCloseTo(0.8, 10);
    // A heavier pseudo-count trusts the career more.
    expect(featuresAtRoundTwo(withShrink(16)).laggedStartRate).toBeGreaterThan(
      featuresAtRoundTwo(withShrink(4)).laggedStartRate,
    );
  });

  it('touches nothing but the start rate', () => {
    const step = featuresAtRoundTwo(FITTED_PARAMS);
    const shrunk = featuresAtRoundTwo(withShrink(4));
    expect(shrunk.laggedSubRate).toBe(step.laggedSubRate);
    expect(shrunk.rates).toEqual(step.rates);
    expect(shrunk.matchesSample).toBe(step.matchesSample);
  });
});
