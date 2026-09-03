import { FITTED_PARAMS, FittedParams } from '../fitted';
import { HistoryRow, walkRounds } from '../features';
import { seasonPriors, buildLeague } from '../strength';

/**
 * The season-start strength prior (B-043, plan 029 task 4).
 *
 * Two claims. The first protects every number already measured: **without `priorSeasonWeight` the
 * walk must hand out exactly the goal rates it handed out before this existed.** The second is what
 * the change is for: at the first deadline of a season, a club that scored twice the league average
 * last year must no longer be priced as an average club.
 */

const row = (
  over: Partial<HistoryRow> & {
    season: string;
    round: number;
    playerCode: number;
    teamCode: number;
    opponentTeamCode: number;
  },
): HistoryRow => ({
  fixture: over.round * 100 + Math.min(over.teamCode, over.opponentTeamCode),
  webName: `P${over.playerCode}`,
  position: 'MID',
  wasHome: over.teamCode < over.opponentTeamCode,
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
 * Four clubs, one season of six rounds in which club 1 scores three a match and club 4 none, then
 * the first round of the next season — and in that next season club 4 is gone and club 5 (promoted)
 * plays instead. One player per club so a row is a team.
 */
const twoSeasons = (): HistoryRow[] => {
  const out: HistoryRow[] = [];
  const goals: Record<number, number> = { 1: 3, 2: 1, 3: 1, 4: 0 };
  for (let r = 1; r <= 6; r++) {
    const pairs = r % 2 === 0 ? [[1, 2], [3, 4]] : [[1, 4], [2, 3]];
    for (const [a, b] of pairs) {
      for (const [team, opp] of [
        [a, b],
        [b, a],
      ]) {
        out.push(
          row({
            season: '2024-25',
            round: r,
            playerCode: team,
            teamCode: team,
            opponentTeamCode: opp,
            goalsScored: goals[team],
            expectedGoals: goals[team],
            goalsConceded: goals[opp],
          }),
        );
      }
    }
  }
  for (const [team, opp] of [
    [1, 5],
    [5, 1],
    [2, 3],
    [3, 2],
  ]) {
    out.push(
      row({
        season: '2025-26',
        round: 1,
        playerCode: team,
        teamCode: team,
        opponentTeamCode: opp,
      }),
    );
  }
  return out;
};

/** λ_for per team at the first round of 2025-26 under the given params. */
const openingLambdas = (params: FittedParams): Map<number, number> => {
  const out = new Map<number, number>();
  for (const context of walkRounds(twoSeasons(), params)) {
    if (context.season !== '2025-26') continue;
    for (const item of context.items) {
      out.set(item.row.teamCode!, item.goalRates.lambdaFor);
    }
  }
  return out;
};

const withPrior = (w: number): FittedParams => ({
  ...FITTED_PARAMS,
  strength: { ...FITTED_PARAMS.strength, priorSeasonWeight: w },
});

describe('season-start strength prior', () => {
  it('changes nothing when the params carry no prior weight, or a weight of 0', () => {
    const before = openingLambdas(FITTED_PARAMS);
    const zero = openingLambdas(withPrior(0));
    expect([...zero.entries()]).toEqual([...before.entries()]);
    // And with no prior, every club opens the season at the league average — the champions and the
    // promoted side are the same fixture, which is the state this change exists to end.
    const home = FITTED_PARAMS.strength.homeAdvantage;
    const avg = FITTED_PARAMS.strength.leagueGoalsPerTeamMatch;
    expect(before.get(1)).toBeCloseTo(avg * home, 10);
    expect(before.get(5)).toBeCloseTo(avg / home, 10);
  });

  it('opens the season with last year in the rating, in proportion to the weight', () => {
    const half = openingLambdas(withPrior(0.5));
    const full = openingLambdas(withPrior(1));
    const none = openingLambdas(withPrior(0));
    // Club 1 scored three a match last season: its opening λ must rise with the weight, and club 3
    // — an average side — must stay near where it was.
    expect(half.get(1)!).toBeGreaterThan(none.get(1)!);
    expect(full.get(1)!).toBeGreaterThan(half.get(1)!);
    expect(Math.abs(full.get(3)! - none.get(3)!)).toBeLessThan(
      Math.abs(full.get(1)! - none.get(1)!),
    );
  });

  it('gives a promoted club the shape of the clubs that went down, not the average', () => {
    const full = openingLambdas(withPrior(1));
    const none = openingLambdas(withPrior(0));
    // Club 5 has no history; its prior is the mean of last season's bottom three, which scored
    // less than average, so it opens BELOW where the league-average target would put it.
    expect(full.get(5)!).toBeLessThan(none.get(5)!);
  });

  it('carries no prior out of an empty league, and the promoted prior is the bottom three', () => {
    expect(seasonPriors(buildLeague([]), FITTED_PARAMS.strength)).toBeNull();
    const league = buildLeague(
      [1, 2, 3, 4].flatMap((team) =>
        [1, 2].map((r) => ({
          teamCode: team,
          opponentTeamCode: team % 2 === 0 ? team - 1 : team + 1,
          fixtureKey: `r${r}-${Math.min(team, team % 2 === 0 ? team - 1 : team + 1)}`,
          expectedGoals: team,
          goalsScored: team,
          ownGoals: 0,
          round: r,
        })),
      ),
    );
    const priors = seasonPriors(league, FITTED_PARAMS.strength)!;
    expect(priors.teams.size).toBe(4);
    // Club 4 scores the most and club 1 the least, so club 4 is not among the bottom three and the
    // promoted prior's attack sits below club 4's.
    expect(priors.promoted.attack).toBeLessThan(priors.teams.get(4)!.attack);
    expect(priors.promoted.attack).toBeGreaterThan(priors.teams.get(1)!.attack);
  });
});
