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
  matches: number;
  xgForPerMatch: number;
  xgAgainstPerMatch: number;
}

/** A per-player row, from either source, reduced to what strength needs. */
export interface StrengthInputRow {
  teamCode: number | null;
  opponentTeamCode: number | null;
  /** unique per team per match — `fixtureId` live, `season|round|fixture` in the archive */
  fixtureKey: string;
  expectedGoals: number;
}

export interface League {
  averageXgPerTeamMatch: number;
  teams: Map<number, TeamStrength>;
}

/**
 * Roll per-player rows up into per-team strength.
 *
 * A team's xG for a fixture is the sum of its players' `expectedGoals`; the same fixture's xG against
 * is the opponent's sum. Both sides are read off the same rows, so no fixture table is needed and the
 * archive and the live database produce identical numbers from identical inputs.
 */
export function buildLeague(rows: StrengthInputRow[]): League {
  const xgFor = new Map<number, number>();
  const fixtures = new Map<number, Set<string>>();
  /** fixtureKey → team → xG, so each team's xG-against is its opponent's xG-for in that fixture */
  const perFixture = new Map<string, Map<number, number>>();

  for (const r of rows) {
    if (r.teamCode === null) continue;
    xgFor.set(r.teamCode, (xgFor.get(r.teamCode) ?? 0) + r.expectedGoals);

    let set = fixtures.get(r.teamCode);
    if (!set) fixtures.set(r.teamCode, (set = new Set()));
    set.add(r.fixtureKey);

    let byTeam = perFixture.get(r.fixtureKey);
    if (!byTeam) perFixture.set(r.fixtureKey, (byTeam = new Map()));
    byTeam.set(r.teamCode, (byTeam.get(r.teamCode) ?? 0) + r.expectedGoals);
  }

  const xgAgainst = new Map<number, number>();
  for (const byTeam of perFixture.values()) {
    const sides = [...byTeam.entries()];
    // A fixture key seen with only one side means the other team's rows were cut away by the time
    // filter, not that it did not play. Skipping keeps xG-against honest rather than crediting a
    // clean sheet nobody kept.
    if (sides.length !== 2) continue;
    for (const [team] of sides) {
      const opponentXg = sides.find(([t]) => t !== team)![1];
      xgAgainst.set(team, (xgAgainst.get(team) ?? 0) + opponentXg);
    }
  }

  const teams = new Map<number, TeamStrength>();
  for (const [teamCode, played] of fixtures) {
    const matches = played.size;
    teams.set(teamCode, {
      teamCode,
      matches,
      xgForPerMatch: matches > 0 ? (xgFor.get(teamCode) ?? 0) / matches : 0,
      xgAgainstPerMatch:
        matches > 0 ? (xgAgainst.get(teamCode) ?? 0) / matches : 0,
    });
  }

  const withData = [...teams.values()].filter((t) => t.matches > 0);
  const averageXgPerTeamMatch =
    withData.length > 0
      ? withData.reduce((s, t) => s + t.xgForPerMatch, 0) / withData.length
      : 0;

  return { averageXgPerTeamMatch, teams };
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
  const avg =
    league.averageXgPerTeamMatch > 0
      ? league.averageXgPerTeamMatch
      : params.leagueGoalsPerTeamMatch;

  const attack = shrunkRatio(team?.xgForPerMatch, team?.matches, avg, params);
  const defence = shrunkRatio(
    opponent?.xgAgainstPerMatch,
    opponent?.matches,
    avg,
    params,
  );
  const oppAttack = shrunkRatio(
    opponent?.xgForPerMatch,
    opponent?.matches,
    avg,
    params,
  );
  const ownDefence = shrunkRatio(
    team?.xgAgainstPerMatch,
    team?.matches,
    avg,
    params,
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
