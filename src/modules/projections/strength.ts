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

/**
 * A club's attack and defence as multiples of the league average, carried across a season boundary
 * (B-043, plan 029 task 4). `attack` above 1 scores more than average; `defence` above 1 CONCEDES
 * more than average — both are the raw ratios `fixtureGoalRates` shrinks, before shrinkage.
 */
export interface TeamPrior {
  attack: number;
  defence: number;
}

export interface League {
  averageXgPerTeamMatch: number;
  /** the same average over ACTUAL goals, decay-weighted the same way the team rates are */
  averageGoalsPerTeamMatch: number;
  teams: Map<number, TeamStrength>;
  /**
   * Where a club's rating is shrunk TOWARD while its own sample is thin, when the walk carries one.
   *
   * Absent is the incumbent: every club is shrunk toward 1.0, the league average — which at the
   * first deadline of a season makes the champions and the promoted side the same fixture, and at
   * `confidenceMatches` 64 keeps them nearly so until October. Set by `walkRounds` from the previous
   * season's final ratios; a club with no entry (promoted) takes `promotedPrior`.
   */
  prior?: Map<number, TeamPrior>;
  promotedPrior?: TeamPrior;
}

/**
 * Roll per-player rows up into per-team strength.
 *
 * A team's xG for a fixture is the sum of its players' `expectedGoals`; the same fixture's xG against
 * is the opponent's sum. Both sides are read off the same rows, so no fixture table is needed and the
 * archive and the live database produce identical numbers from identical inputs.
 */
/** Shared empty map for a fixture with no goal rows, so the fallback carries a concrete type. */
const EMPTY_GOALS: ReadonlyMap<number, number> = new Map<number, number>();

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
    const goalsByTeam = goalsPerFixture.get(key) ?? EMPTY_GOALS;

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
   * How much of last season's final rating a club starts this season with (B-043, plan 029 task 4).
   *
   * The shrinkage target becomes `1 + w × (prior − 1)`: 0 (or absent) is the incumbent's league
   * average, 1 is last season's ratio in full. Applied only where the walk has carried a prior in;
   * with none, the target is 1.0 whatever this says.
   */
  priorSeasonWeight?: number;
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
  /**
   * The two club codes, for the season-start prior (plan 029 task 4). Needed separately because at
   * the first deadline of a season neither club has a `TeamStrength` yet — which is exactly when
   * the prior does its work. Optional, and with no prior on the league they are never read.
   */
  codes: { team: number | null; opponent: number | null } = {
    team: team?.teamCode ?? null,
    opponent: opponent?.teamCode ?? null,
  },
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
    target: number,
  ): number => {
    const w = Math.max(0, Math.min(1, params.goalsWeight));
    const fromXg = shrunkRatio(xgValue, matches, xgAvg, params, target);
    if (w === 0) return fromXg;
    const fromGoals = shrunkRatio(goalsValue, matches, goalsAvg, params, target);
    return (1 - w) * fromXg + w * fromGoals;
  };

  // The shrinkage target per side: the league average, or last season's ratio pulled toward it by
  // `priorSeasonWeight`. A team the walk has no prior for — promoted, or a season with nothing
  // before it — takes the promoted prior, and with no prior carried at all this is exactly 1.
  const targetFor = (code: number | null, side: keyof TeamPrior): number => {
    const w = params.priorSeasonWeight ?? 0;
    if (w <= 0 || !league.prior || code === null) return 1;
    const prior = league.prior.get(code) ?? league.promotedPrior;
    if (!prior) return 1;
    return 1 + w * (prior[side] - 1);
  };

  const attack = ratio(
    team?.xgForPerMatch,
    team?.goalsForPerMatch,
    team?.matches,
    targetFor(codes.team, 'attack'),
  );
  const defence = ratio(
    opponent?.xgAgainstPerMatch,
    opponent?.goalsAgainstPerMatch,
    opponent?.matches,
    targetFor(codes.opponent, 'defence'),
  );
  const oppAttack = ratio(
    opponent?.xgForPerMatch,
    opponent?.goalsForPerMatch,
    opponent?.matches,
    targetFor(codes.opponent, 'attack'),
  );
  const ownDefence = ratio(
    team?.xgAgainstPerMatch,
    team?.goalsAgainstPerMatch,
    team?.matches,
    targetFor(codes.team, 'defence'),
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

/**
 * A team's rate as a multiple of the league average, shrunk toward `target` while the sample is
 * thin. `target` is 1 — the league average — unless the walk carries a prior for this club.
 *
 * A team with no record at all returns the target rather than 1: at the first deadline of a season
 * that is the whole difference between "every club is average" and "the champions are the
 * champions until proven otherwise".
 */
function shrunkRatio(
  value: number | undefined,
  matches: number | undefined,
  leagueAverage: number,
  params: StrengthParams,
  target = 1,
): number {
  if (value === undefined || !matches || leagueAverage <= 0) return target;
  const raw = value / leagueAverage;
  const confidence = matches / (matches + params.confidenceMatches);
  return confidence * raw + (1 - confidence) * target;
}

/**
 * What one season leaves behind for the next: each club's UNSHRUNK blended attack and defence
 * ratios at the season's end, and the prior a promoted club inherits — the mean of the three clubs
 * that finished with the worst goal-ratio difference, which is the shape of a side that has just
 * come up. A league with fewer than three clubs, or none, leaves no priors at all.
 *
 * Unshrunk on purpose: a full season is 38 matches, and shrinking it again at the point of use is
 * `priorSeasonWeight`'s job, chosen on the referee rather than assumed here.
 */
export function seasonPriors(
  league: League,
  params: StrengthParams,
): { teams: Map<number, TeamPrior>; promoted: TeamPrior } | null {
  const xgAvg = league.averageXgPerTeamMatch;
  const goalsAvg = league.averageGoalsPerTeamMatch;
  const w = Math.max(0, Math.min(1, params.goalsWeight));
  const teams = new Map<number, TeamPrior>();
  for (const t of league.teams.values()) {
    if (t.matches === 0) continue;
    const blend = (xgValue: number, goalsValue: number): number => {
      const fromXg = xgAvg > 0 ? xgValue / xgAvg : 1;
      const fromGoals = goalsAvg > 0 ? goalsValue / goalsAvg : 1;
      return (1 - w) * fromXg + w * fromGoals;
    };
    teams.set(t.teamCode, {
      attack: blend(t.xgForPerMatch, t.goalsForPerMatch),
      defence: blend(t.xgAgainstPerMatch, t.goalsAgainstPerMatch),
    });
  }
  if (teams.size < 3) return null;
  const bottom = [...teams.values()]
    .sort((a, b) => a.attack - a.defence - (b.attack - b.defence))
    .slice(0, 3);
  const promoted: TeamPrior = {
    attack: bottom.reduce((s, t) => s + t.attack, 0) / bottom.length,
    defence: bottom.reduce((s, t) => s + t.defence, 0) / bottom.length,
  };
  return { teams, promoted };
}

/** P(clean sheet) — the team concedes nothing, straight off the same lambda that prices conceding. */
export function cleanSheetProbability(lambdaAgainst: number): number {
  return Math.exp(-Math.max(0, lambdaAgainst));
}
