/**
 * Lagged rolling team strength, and the fixture goal rates it produces.
 *
 * **Why this replaces FDR.** v1 fed FPL's FDR digit (1–5) into `attackMultiplier`, `cleanSheetProb`
 * and `expectedGoalsConceded`. The archive carries no FDR and historical FDR cannot be obtained, so
 * those curves could never be fitted — and fitting a curve on one input scale while serving it against
 * another is a calibration error that no test catches, since each side looks fine alone.
 *
 * So the fixture input becomes team strength derived from expected goals, computed by the SAME
 * function over either source: `archive_player_gameweek` for past seasons,
 * `player_gameweek_stats` for the live one. Both carry per-player `expectedGoals`, and a team's xG for
 * a fixture is the sum over its players — a definition that needs nothing either source lacks.
 *
 * The goal model is the standard multiplicative one: a team's expected goals in a fixture are the
 * league average scaled by its own attack, by its opponent's defensive weakness, and by home
 * advantage. That buys two things the FDR curves could not have:
 *
 *   - **P(clean sheet) stops being a hand-drawn line.** It is `P(Poisson(λ_against) = 0)`, which falls
 *     out of the same λ that prices goals conceded, so the two terms can no longer disagree.
 *   - Attack and defence are separate. FDR conflates them into one digit, but scoring is about the
 *     opponent's defence and clean sheets are about their attack.
 */

/** One team's rolling form, from fixtures strictly before the round being predicted. */
export interface TeamStrength {
  /** stable key: `Team.code` live, `teamCode` in the archive — never the 1-20 id, which shifts */
  teamCode: number;
  /** fixtures counted, undecayed — the sample the shrinkage is a function of */
  matches: number;
  xgForPerMatch: number;
  xgAgainstPerMatch: number;
  /**
   * The same two quantities from ACTUAL goals, decay-weighted (B-014).
   *
   * A team's goals in a fixture are the sum of its players' `goalsScored` plus the opponent's
   * `ownGoals` — an own goal counts on the scoreboard for the team that did not kick it, and the
   * archive records it on the player who did. Neither source carries a team score, so this rollup is
   * the definition, and it is the same rollup on both sides by construction.
   */
  goalsForPerMatch: number;
  goalsAgainstPerMatch: number;
}

/** A per-player row, from either source, reduced to what strength needs. */
export interface StrengthInputRow {
  teamCode: number | null;
  opponentTeamCode: number | null;
  /** unique per team per match — `fixtureId` live, `season|round|fixture` in the archive */
  fixtureKey: string;
  expectedGoals: number;
  goalsScored: number;
  ownGoals: number;
  /** the round this row happened in, for the recency decay */
  round: number;
}

export interface League {
  averageXgPerTeamMatch: number;
  /** the same average over ACTUAL goals, decay-weighted the same way the team rates are */
  averageGoalsPerTeamMatch: number;
  teams: Map<number, TeamStrength>;
}

/**
 * Roll per-player rows up into per-team strength.
 *
 * A team's xG for a fixture is the sum of its players' `expectedGoals`; the same fixture's xG against
 * is the opponent's sum. Both sides are read off the same rows, so no fixture table is needed and the
 * archive and the live database produce identical numbers from identical inputs.
 */
export function buildLeague(
  rows: StrengthInputRow[],
  /**
   * The round the league is being built FOR, and the decay half-life in rounds.
   *
   * A match from round 1 counted as much as last week's until B-014. Both default to "no decay", so
   * a caller that does not care gets the previous behaviour rather than a silent re-weighting.
   */
  asOfRound = 0,
  decayHalfLife = 0,
): League {
  const xgFor = new Map<number, number>();
  const fixtures = new Map<number, Set<string>>();
  /** fixtureKey → team → xG, so each team's xG-against is its opponent's xG-for in that fixture */
  const perFixture = new Map<string, Map<number, number>>();
  /** fixtureKey → team → goals actually scored BY that team (own goals credited to the opponent) */
  const goalsPerFixture = new Map<string, Map<number, number>>();
  /** fixtureKey → the decay weight of that fixture; one weight per fixture, not per player row */
  const fixtureWeight = new Map<string, number>();

  const weightFor = (round: number): number => {
    if (decayHalfLife <= 0 || asOfRound <= 0) return 1;
    const age = Math.max(0, asOfRound - round);
    return Math.pow(0.5, age / decayHalfLife);
  };

  for (const r of rows) {
    if (r.teamCode === null) continue;
    xgFor.set(r.teamCode, (xgFor.get(r.teamCode) ?? 0) + r.expectedGoals);

    let set = fixtures.get(r.teamCode);
    if (!set) fixtures.set(r.teamCode, (set = new Set()));
    set.add(r.fixtureKey);

    let byTeam = perFixture.get(r.fixtureKey);
    if (!byTeam) perFixture.set(r.fixtureKey, (byTeam = new Map()));
    byTeam.set(r.teamCode, (byTeam.get(r.teamCode) ?? 0) + r.expectedGoals);

    let goalsByTeam = goalsPerFixture.get(r.fixtureKey);
    if (!goalsByTeam)
      goalsPerFixture.set(r.fixtureKey, (goalsByTeam = new Map()));
    goalsByTeam.set(
      r.teamCode,
      (goalsByTeam.get(r.teamCode) ?? 0) + r.goalsScored,
    );
    // An own goal counts on the scoreboard for the OTHER team, and is recorded against the player who
    // kicked it. Credited across here, which is the only place both sides of the fixture are in hand.
    if (r.ownGoals > 0 && r.opponentTeamCode !== null) {
      goalsByTeam.set(
        r.opponentTeamCode,
        (goalsByTeam.get(r.opponentTeamCode) ?? 0) + r.ownGoals,
      );
    }

    fixtureWeight.set(r.fixtureKey, weightFor(r.round));
  }

  const xgAgainst = new Map<number, number>();
  const goalsFor = new Map<number, number>();
  const goalsAgainst = new Map<number, number>();
  /** decay-weighted fixture count per team — the denominator the weighted rates divide by */
  const weightedMatches = new Map<number, number>();

  for (const [key, byTeam] of perFixture) {
    const sides = [...byTeam.entries()];
    // A fixture key seen with only one side means the other team's rows were cut away by the time
    // filter, not that it did not play. Skipping keeps xG-against honest rather than crediting a
    // clean sheet nobody kept.
    if (sides.length !== 2) continue;
    const w = fixtureWeight.get(key) ?? 1;
    const goalsByTeam: Map<number, number> =
      goalsPerFixture.get(key) ?? new Map();

    for (const [team] of sides) {
      const opponent = sides.find(([t]) => t !== team)![0];
      const opponentXg = byTeam.get(opponent) ?? 0;
      xgAgainst.set(team, (xgAgainst.get(team) ?? 0) + opponentXg);

      goalsFor.set(
        team,
        (goalsFor.get(team) ?? 0) + w * (goalsByTeam.get(team) ?? 0),
      );
      goalsAgainst.set(
        team,
        (goalsAgainst.get(team) ?? 0) + w * (goalsByTeam.get(opponent) ?? 0),
      );
      weightedMatches.set(team, (weightedMatches.get(team) ?? 0) + w);
    }
  }

  const teams = new Map<number, TeamStrength>();
  for (const [teamCode, played] of fixtures) {
    const matches = played.size;
    const wm = weightedMatches.get(teamCode) ?? 0;
    teams.set(teamCode, {
      teamCode,
      matches,
      xgForPerMatch: matches > 0 ? (xgFor.get(teamCode) ?? 0) / matches : 0,
      xgAgainstPerMatch:
        matches > 0 ? (xgAgainst.get(teamCode) ?? 0) / matches : 0,
      goalsForPerMatch: wm > 0 ? (goalsFor.get(teamCode) ?? 0) / wm : 0,
      goalsAgainstPerMatch: wm > 0 ? (goalsAgainst.get(teamCode) ?? 0) / wm : 0,
    });
  }

  const withData = [...teams.values()].filter((t) => t.matches > 0);
  const averageXgPerTeamMatch =
    withData.length > 0
      ? withData.reduce((s, t) => s + t.xgForPerMatch, 0) / withData.length
      : 0;
  const averageGoalsPerTeamMatch =
    withData.length > 0
      ? withData.reduce((s, t) => s + t.goalsForPerMatch, 0) / withData.length
      : 0;

  return { averageXgPerTeamMatch, averageGoalsPerTeamMatch, teams };
}

export interface GoalRates {
  /** expected goals scored by this player's team in this fixture */
  lambdaFor: number;
  /** expected goals conceded by this player's team in this fixture */
  lambdaAgainst: number;
  /** how much easier or harder than an average fixture this is for attacking output, ~1.0 at average */
  attackAdjustment: number;
}

export interface StrengthParams {
  /** multiplicative home advantage on goals scored (and its reciprocal on goals conceded) */
  homeAdvantage: number;
  /** matches of a team's own data before its strength is trusted over the league mean */
  confidenceMatches: number;
  /** league-average goals per team per match, the anchor a shrunk strength returns to */
  leagueGoalsPerTeamMatch: number;
  /**
   * How much of a team's strength comes from ACTUAL goals rather than from the sum of its players'
   * expected goals. 0 is the incumbent definition, 1 is pure goals (B-014).
   *
   * Searched, not chosen — the whole question B-014 asks is whether the strength ESTIMATE is what
   * made the fixture elasticities fit to zero, and asserting an answer to that would be the same
   * mistake in the other direction. 0 is the null candidate under D-023.
   */
  goalsWeight: number;
  /**
   * Recency half-life in rounds for the goals-based rates. 0 disables decay entirely.
   *
   * Only the goals side decays. The xG side is left undecayed so that `goalsWeight = 0` reproduces
   * the incumbent model exactly, which is what makes the search a comparison rather than two changes
   * at once.
   */
  decayHalfLife: number;
}

/**
 * Expected goals either way for one fixture.
 *
 * Both strengths are shrunk toward the league mean by how many matches they rest on: an unbeaten team
 * three games in is mostly noise, and early-season is exactly where a projection is asked for most
 * confidently. With no data at all, both sides collapse to the league average, which is the cold start
 * FDR used to cover.
 */
export function fixtureGoalRates(
  team: TeamStrength | undefined,
  opponent: TeamStrength | undefined,
  isHome: boolean,
  league: League,
  params: StrengthParams,
): GoalRates {
  const xgAvg =
    league.averageXgPerTeamMatch > 0
      ? league.averageXgPerTeamMatch
      : params.leagueGoalsPerTeamMatch;
  const goalsAvg =
    league.averageGoalsPerTeamMatch > 0
      ? league.averageGoalsPerTeamMatch
      : params.leagueGoalsPerTeamMatch;

  /**
   * One team-versus-league ratio, blended across the two definitions of "how much a team scores".
   *
   * The blend is on the RATIO rather than on the raw rates, because the two are on different scales:
   * expected goals and actual goals do not have the same league mean, and averaging them directly
   * would let the noisier of the two dominate purely by being larger.
   */
  const ratio = (
    xgValue: number | undefined,
    goalsValue: number | undefined,
    matches: number | undefined,
  ): number => {
    const w = Math.max(0, Math.min(1, params.goalsWeight));
    const fromXg = shrunkRatio(xgValue, matches, xgAvg, params);
    if (w === 0) return fromXg;
    const fromGoals = shrunkRatio(goalsValue, matches, goalsAvg, params);
    return (1 - w) * fromXg + w * fromGoals;
  };

  const attack = ratio(
    team?.xgForPerMatch,
    team?.goalsForPerMatch,
    team?.matches,
  );
  const defence = ratio(
    opponent?.xgAgainstPerMatch,
    opponent?.goalsAgainstPerMatch,
    opponent?.matches,
  );
  const oppAttack = ratio(
    opponent?.xgForPerMatch,
    opponent?.goalsForPerMatch,
    opponent?.matches,
  );
  const ownDefence = ratio(
    team?.xgAgainstPerMatch,
    team?.goalsAgainstPerMatch,
    team?.matches,
  );

  const home = isHome ? params.homeAdvantage : 1 / params.homeAdvantage;

  const lambdaFor = params.leagueGoalsPerTeamMatch * attack * defence * home;
  const lambdaAgainst =
    (params.leagueGoalsPerTeamMatch * oppAttack * ownDefence) / home;

  return {
    lambdaFor,
    lambdaAgainst,
    attackAdjustment:
      params.leagueGoalsPerTeamMatch > 0
        ? lambdaFor / params.leagueGoalsPerTeamMatch
        : 1,
  };
}

/** A team's rate as a multiple of the league average, shrunk toward 1 while the sample is thin. */
function shrunkRatio(
  value: number | undefined,
  matches: number | undefined,
  leagueAverage: number,
  params: StrengthParams,
): number {
  if (value === undefined || !matches || leagueAverage <= 0) return 1;
  const raw = value / leagueAverage;
  const confidence = matches / (matches + params.confidenceMatches);
  return confidence * raw + (1 - confidence) * 1;
}

/** P(clean sheet) — the team concedes nothing, straight off the same lambda that prices conceding. */
export function cleanSheetProbability(lambdaAgainst: number): number {
  return Math.exp(-Math.max(0, lambdaAgainst));
}
