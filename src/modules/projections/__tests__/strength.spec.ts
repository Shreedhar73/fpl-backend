import {
  buildLeague,
  fixtureGoalRates,
  StrengthInputRow,
  StrengthParams,
} from '../strength';
import { HistoryRow, walkRounds } from '../features';
import { FITTED_PARAMS, UNFITTED_PARAMS } from '../fitted';

/**
 * B-014 — team strength from actual goals, and the pin test owed since plan 007 (items 219, 262).
 *
 * The constraint that must not be silently broken: **the archive and the live database must produce
 * identical λ from identical football.** They are different tables with different key types — the
 * archive keys a fixture by `season|round|fixture` integers, the live path by a cuid mapped to a
 * per-season integer — and if the two ever diverged, the calibration harness would stop measuring
 * the thing that serves, with nothing in either output looking wrong.
 *
 * The second thing tested here is the own-goal credit. An own goal counts on the scoreboard for the
 * team that did not kick it, and both sources record it on the player who did. Getting that backwards
 * flatters the conceding team twice over and would be invisible in any aggregate.
 */

const params = (over: Partial<StrengthParams> = {}): StrengthParams => ({
  homeAdvantage: 1.12,
  confidenceMatches: 4,
  leagueGoalsPerTeamMatch: 1.5,
  goalsWeight: 0,
  decayHalfLife: 0,
  ...over,
});

const inputRow = (over: Partial<StrengthInputRow>): StrengthInputRow => ({
  teamCode: 1,
  opponentTeamCode: 2,
  fixtureKey: 'f1',
  expectedGoals: 0,
  goalsScored: 0,
  ownGoals: 0,
  round: 1,
  ...over,
});

/** One match: two teams, one row each, with the goals and xG named from each side. */
const match = (
  key: string,
  round: number,
  home: { team: number; goals: number; xg: number; ownGoals?: number },
  away: { team: number; goals: number; xg: number; ownGoals?: number },
): StrengthInputRow[] => [
  inputRow({
    fixtureKey: key,
    round,
    teamCode: home.team,
    opponentTeamCode: away.team,
    goalsScored: home.goals,
    expectedGoals: home.xg,
    ownGoals: home.ownGoals ?? 0,
  }),
  inputRow({
    fixtureKey: key,
    round,
    teamCode: away.team,
    opponentTeamCode: home.team,
    goalsScored: away.goals,
    expectedGoals: away.xg,
    ownGoals: away.ownGoals ?? 0,
  }),
];

describe('goals, as buildLeague rolls them up', () => {
  it("reads a team's goals against off its opponent's goals for", () => {
    const league = buildLeague(
      match(
        'f1',
        1,
        { team: 1, goals: 3, xg: 2.1 },
        { team: 2, goals: 1, xg: 0.8 },
      ),
    );
    expect(league.teams.get(1)!.goalsForPerMatch).toBeCloseTo(3);
    expect(league.teams.get(1)!.goalsAgainstPerMatch).toBeCloseTo(1);
    expect(league.teams.get(2)!.goalsForPerMatch).toBeCloseTo(1);
    expect(league.teams.get(2)!.goalsAgainstPerMatch).toBeCloseTo(3);
  });

  /**
   * The one that would be invisible if it were backwards. Team 2 puts through its own net; the goal
   * belongs to team 1's tally and to team 2's conceded column, and neither source records it that way.
   */
  it('credits an own goal to the team that did not kick it', () => {
    const league = buildLeague(
      match(
        'f1',
        1,
        { team: 1, goals: 0, xg: 0.4 },
        { team: 2, goals: 0, xg: 0.3, ownGoals: 1 },
      ),
    );
    expect(league.teams.get(1)!.goalsForPerMatch).toBeCloseTo(1);
    expect(league.teams.get(1)!.goalsAgainstPerMatch).toBeCloseTo(0);
    expect(league.teams.get(2)!.goalsForPerMatch).toBeCloseTo(0);
    expect(league.teams.get(2)!.goalsAgainstPerMatch).toBeCloseTo(1);
  });

  it('skips a fixture with only one side, for goals as well as for xG', () => {
    const league = buildLeague([
      inputRow({ teamCode: 1, opponentTeamCode: 2, goalsScored: 2 }),
    ]);
    expect(league.teams.get(1)!.goalsForPerMatch).toBe(0);
    expect(league.teams.get(1)!.goalsAgainstPerMatch).toBe(0);
    // The fixture still counts as a match played, which is what the shrinkage reads.
    expect(league.teams.get(1)!.matches).toBe(1);
  });
});

describe('recency decay', () => {
  const rounds = [
    ...match(
      'f1',
      1,
      { team: 1, goals: 4, xg: 1 },
      { team: 2, goals: 0, xg: 1 },
    ),
    ...match(
      'f2',
      10,
      { team: 1, goals: 0, xg: 1 },
      { team: 3, goals: 0, xg: 1 },
    ),
  ];

  it('weights every match equally when the half-life is 0', () => {
    const league = buildLeague(rounds, 11, 0);
    expect(league.teams.get(1)!.goalsForPerMatch).toBeCloseTo(2); // (4 + 0) / 2
  });

  it('weights the recent match more when a half-life is set', () => {
    // Half-life 5, as of round 11: the round-1 match is 10 rounds old and carries weight 0.25, the
    // round-10 match is 1 round old and carries 0.87. So 4 goals ten rounds ago average down.
    const league = buildLeague(rounds, 11, 5);
    expect(league.teams.get(1)!.goalsForPerMatch).toBeLessThan(2);
    expect(league.teams.get(1)!.goalsForPerMatch).toBeGreaterThan(0);
  });

  it('leaves the xG side undecayed, so goalsWeight 0 reproduces the incumbent exactly', () => {
    // This is what makes the search in `fitParams` a comparison rather than two changes at once.
    const undecayed = buildLeague(rounds, 11, 0);
    const decayed = buildLeague(rounds, 11, 4);
    expect(decayed.teams.get(1)!.xgForPerMatch).toBeCloseTo(
      undecayed.teams.get(1)!.xgForPerMatch,
      10,
    );
    expect(decayed.teams.get(1)!.goalsForPerMatch).not.toBeCloseTo(
      undecayed.teams.get(1)!.goalsForPerMatch,
      6,
    );
  });
});

describe('the blend', () => {
  const league = buildLeague(
    // Team 1 scores far more than its xG; team 2 the reverse. The two definitions disagree, which is
    // the only situation in which the blend weight can be observed at all.
    [
      ...match(
        'f1',
        1,
        { team: 1, goals: 4, xg: 1.0 },
        { team: 2, goals: 0, xg: 1.0 },
      ),
      ...match(
        'f2',
        2,
        { team: 1, goals: 4, xg: 1.0 },
        { team: 3, goals: 0, xg: 1.0 },
      ),
    ],
  );

  it('goalsWeight 0 uses expected goals alone', () => {
    const xgOnly = fixtureGoalRates(
      league.teams.get(1),
      league.teams.get(2),
      true,
      league,
      params({ goalsWeight: 0 }),
    );
    const blended = fixtureGoalRates(
      league.teams.get(1),
      league.teams.get(2),
      true,
      league,
      params({ goalsWeight: 1 }),
    );
    // Team 1 outscores its xG, so the goals-based view rates it higher.
    expect(blended.lambdaFor).toBeGreaterThan(xgOnly.lambdaFor);
  });

  it('is monotone in the weight', () => {
    const lambdas = [0, 0.25, 0.5, 0.75, 1].map(
      (goalsWeight) =>
        fixtureGoalRates(
          league.teams.get(1),
          league.teams.get(2),
          true,
          league,
          params({ goalsWeight }),
        ).lambdaFor,
    );
    for (let i = 1; i < lambdas.length; i++) {
      expect(lambdas[i]).toBeGreaterThan(lambdas[i - 1]);
    }
  });

  it('still collapses to the league average for a team with no data', () => {
    const empty = buildLeague([]);
    const r = fixtureGoalRates(
      undefined,
      undefined,
      true,
      empty,
      params({ goalsWeight: 1, decayHalfLife: 6 }),
    );
    expect(r.lambdaFor).toBeCloseTo(1.5 * 1.12, 6);
    expect(r.lambdaAgainst).toBeCloseTo(1.5 / 1.12, 6);
  });
});

const historyRow = (over: Partial<HistoryRow>): HistoryRow => ({
  season: '2025-26',
  round: 1,
  fixture: 1,
  playerCode: 1,
  webName: 'Player',
  position: 'MID',
  teamCode: 1,
  opponentTeamCode: 2,
  wasHome: true,
  minutes: 90,
  starts: 1,
  totalPoints: 2,
  goalsScored: 0,
  ownGoals: 0,
  assists: 0,
  cleanSheets: 0,
  goalsConceded: 0,
  saves: 0,
  bonus: 0,
  bps: 0,
  defensiveContribution: null,
  expectedGoals: 0,
  expectedAssists: 0,
  expectedGoalsConceded: 0,
  ictIndex: 0,
  value: 50,
  ...over,
});

/**
 * THE PIN TEST — plan 007 items 219 and 262, owed and unwritten until B-014.
 *
 * `archiveHistory` and `currentSeasonHistory` read different tables with different key types and
 * produce the same `HistoryRow` shape. Everything downstream — strength, features, the projection —
 * is supposed to be blind to which one it came from. If it ever stopped being, the backtest would
 * measure a different model from the one that serves, and neither report would look wrong.
 */
describe('the archive and the live path produce identical strength', () => {
  /** The same two matches, expressed the way each source expresses them. */
  const football = (season: string, fixtureBase: number): HistoryRow[] => [
    historyRow({
      season,
      round: 1,
      fixture: fixtureBase,
      playerCode: 10,
      teamCode: 1,
      opponentTeamCode: 2,
      goalsScored: 2,
      expectedGoals: 1.4,
    }),
    historyRow({
      season,
      round: 1,
      fixture: fixtureBase,
      playerCode: 20,
      teamCode: 2,
      opponentTeamCode: 1,
      wasHome: false,
      goalsScored: 0,
      expectedGoals: 0.6,
    }),
    historyRow({
      season,
      round: 2,
      fixture: fixtureBase + 1,
      playerCode: 10,
      teamCode: 1,
      opponentTeamCode: 3,
      goalsScored: 1,
      expectedGoals: 1.1,
    }),
    historyRow({
      season,
      round: 2,
      fixture: fixtureBase + 1,
      playerCode: 30,
      teamCode: 3,
      opponentTeamCode: 1,
      wasHome: false,
      goalsScored: 1,
      expectedGoals: 0.9,
    }),
    // A third round with no outcome worth reading. It exists so the LAST yielded context is round 3,
    // whose league is built from rounds 1 and 2 — `walkRounds` hands out a round's features before
    // folding that round in, so the final context's league never contains the final round.
    historyRow({
      season,
      round: 3,
      fixture: fixtureBase + 2,
      playerCode: 10,
      teamCode: 1,
      opponentTeamCode: 2,
    }),
    historyRow({
      season,
      round: 3,
      fixture: fixtureBase + 2,
      playerCode: 20,
      teamCode: 2,
      opponentTeamCode: 1,
      wasHome: false,
    }),
  ];

  const strengthAfter = (rows: HistoryRow[]) => {
    const contexts = [...walkRounds(rows, FITTED_PARAMS)];
    return contexts[contexts.length - 1].league;
  };

  it('same football, different fixture ids and season labels, same numbers', () => {
    // The archive numbers fixtures from the season's own id space; the live reader mints its own
    // integers from cuids. Only uniqueness within a round is supposed to matter.
    const archiveShaped = strengthAfter(football('2024-25', 3821));
    const liveShaped = strengthAfter(football('2026-27', 1));

    for (const team of [1, 2, 3]) {
      const a = archiveShaped.teams.get(team)!;
      const b = liveShaped.teams.get(team)!;
      expect(b.matches).toBe(a.matches);
      expect(b.xgForPerMatch).toBeCloseTo(a.xgForPerMatch, 10);
      expect(b.xgAgainstPerMatch).toBeCloseTo(a.xgAgainstPerMatch, 10);
      expect(b.goalsForPerMatch).toBeCloseTo(a.goalsForPerMatch, 10);
      expect(b.goalsAgainstPerMatch).toBeCloseTo(a.goalsAgainstPerMatch, 10);
    }
    expect(liveShaped.averageGoalsPerTeamMatch).toBeCloseTo(
      archiveShaped.averageGoalsPerTeamMatch,
      10,
    );
  });

  it('and identical λ out of fixtureGoalRates, which is what actually reaches the model', () => {
    const a = strengthAfter(football('2024-25', 3821));
    const b = strengthAfter(football('2026-27', 1));
    const rate = (l: typeof a) =>
      fixtureGoalRates(
        l.teams.get(1),
        l.teams.get(2),
        true,
        l,
        FITTED_PARAMS.strength,
      );
    expect(rate(b).lambdaFor).toBeCloseTo(rate(a).lambdaFor, 10);
    expect(rate(b).lambdaAgainst).toBeCloseTo(rate(a).lambdaAgainst, 10);
  });

  /**
   * The sabotage. If the pin above passes because both sides compute *nothing*, it proves nothing.
   * Change the football and the numbers must move.
   */
  it('and the pin is not vacuous — different football gives different numbers', () => {
    const normal = strengthAfter(football('2024-25', 3821));
    const scoring = strengthAfter(
      football('2024-25', 3821).map((r) =>
        r.teamCode === 1 ? { ...r, goalsScored: r.goalsScored + 3 } : r,
      ),
    );
    expect(scoring.teams.get(1)!.goalsForPerMatch).toBeGreaterThan(
      normal.teams.get(1)!.goalsForPerMatch,
    );
  });
});

describe('the unfitted baseline still describes v1', () => {
  it('has no goals term and no decay, so it is the model B-014 is compared against', () => {
    expect(UNFITTED_PARAMS.strength.goalsWeight).toBe(0);
    expect(UNFITTED_PARAMS.strength.decayHalfLife).toBe(0);
  });
});
