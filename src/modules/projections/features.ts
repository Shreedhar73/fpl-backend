import { PositionCode } from '../fpl-sync/mappers';
import {
  buildLeague,
  fixtureGoalRates,
  GoalRates,
  League,
  StrengthInputRow,
} from './strength';
import { FittedParams } from './fitted';
import { PlayerRates } from './model-v2';

/**
 * Turns a season's rows into the features a projection is allowed to have seen, and nothing else.
 *
 * **Everything here exists to make the time cut structural rather than remembered.** The engine walks
 * rounds in order and, at each one, hands out features built only from rounds already folded in — so a
 * caller cannot accidentally read the round it is predicting, because the accumulators do not contain
 * it yet. The alternative (filter the whole table per round) is both slower and easy to get subtly
 * wrong: one aggregate computed over a full season leaks the future into its own early gameweeks and
 * nothing in the output looks wrong.
 *
 * One forward pass, O(rows). Prior seasons carry over as priors; the current season's rows accumulate
 * as it goes.
 */

export interface HistoryRow {
  season: string;
  round: number;
  fixture: number;
  playerCode: number;
  webName: string;
  position: PositionCode;
  teamCode: number | null;
  opponentTeamCode: number | null;
  wasHome: boolean;
  minutes: number;
  /** null before 2023-24 — the archive did not record it, which is not "came off the bench" */
  starts: number | null;
  totalPoints: number;
  goalsScored: number;
  ownGoals: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  bonus: number;
  bps: number;
  defensiveContribution: number | null;
  /** null before 2022-23 — the category did not exist in the archive */
  expectedGoals: number | null;
  expectedAssists: number | null;
  /** the player's xG conceded while on the pitch — the defensive twin of `expectedGoals` */
  expectedGoalsConceded: number | null;
  /** FPL's ICT index for the match — carried for the v4 feature export (B-034), unread by v3 */
  ictIndex: number;
  /**
   * The ICT split (B-037). Null where the source has no column — the live table, and any archive
   * row imported before the migration. Missing, never zero: the exporter forwards null as a missing
   * cell and the trees route it through default_left.
   */
  influence: number | null;
  creativity: number | null;
  threat: number | null;
  value: number;
  /**
   * Deadline-time availability flags (plan 024), joined from `archive_availability_snapshot` for
   * archive rows within the staleness bound. OPTIONAL and nullable, and the two states differ:
   * `undefined`/`null` means the record has no capture for this round — unknown, which the fitted
   * model prices with its own coefficient, never as available. These are what was knowable BEFORE
   * the round; they are features for the minutes fit and are read by nothing else.
   */
  deadlineStatus?: string | null;
  deadlineChance?: number | null;
}

/** What the model is allowed to know about a player before a round it has not seen. */
export interface PlayerFeatures {
  rates: PlayerRates;
  laggedStartRate: number;
  /** appearances the rates rest on — thin samples are shrunk, and the report says how thin */
  minutesSample: number;
  matchesSample: number;
  /**
   * Premier League appearances — gameweek rows with **minutes > 0** — before this round.
   *
   * Not the same number as `matchesSample`, which counts every row including unused-sub zeros. The
   * names are close and the values are not, which is a trap worth naming: B-010's appearance floor is
   * defined on this one.
   *
   * **Accumulated by the walk, deliberately, rather than read from `appearanceCounts()`.** That query
   * returns appearances as of *today*; handing it to a backtest at round 1 of a past season tells the
   * caller how often a player *would go on to* feature. It is the same class of leak `walkRounds`
   * exists to prevent, and it produces no error and nothing wrong-looking in the output.
   */
  appearancesSample: number;
  /**
   * The player's own `P(appear | did not start)`, lagged and smoothed — B-019.
   *
   * The direct counterpart of `laggedStartRate` for the other half of the minutes model. Until this
   * existed, every non-starter in the league was paid one global 15.4% chance of coming on, which
   * B-013 measured as the model's worst-calibrated term by a factor of ten: a fringe player who will
   * never be used and a first substitute who always comes on were given the same number.
   *
   * Smoothed toward the population prior so it is DEFINED for a player who has started every match
   * he has played — there is no empirical rate for him — and so three non-starts cannot produce a 0
   * or a 1 that the logit would then have to clamp.
   */
  laggedSubRate: number;
  /** trailing-30-day points per match, recomputed rather than read: the archive has no `form` column */
  form: number | null;
  /** previous season's points per 90, the other baseline */
  priorSeasonPointsPer90: number | null;
  /**
   * Previous season's VOLUME, which `priorSeasonPointsPer90` deliberately divides away.
   *
   * At the first deadline of a season every rolling feature is either empty or describes the run-in
   * of the season before — a title already won, a striker rested, a dead rubber. A rate cannot tell
   * "finished the season being rested" from "was never picked"; minutes and starts can. Measured in
   * a parallel backtest, a model without these terms ranked the previous season's highest scorer
   * 224th of 616 for an opening gameweek, because his last two rows were blanks.
   *
   * Null when the player has no previous season in the walked rows — which is NOT the same as zero,
   * and every consumer has to treat it that way.
   */
  priorSeasonMinutes: number | null;
  priorSeasonStartRate: number | null;
  priorSeasonAppearances: number | null;
  /**
   * Seasons between the previous one and this, so a year out of the league is visible.
   *
   * 1 for consecutive seasons. Without it, a player last seen two seasons ago looks exactly like one
   * who played last year.
   */
  priorSeasonGap: number | null;
}

/**
 * What is carried across a season boundary.
 *
 * Points per ninety alone cannot separate the two players the opening gameweek of a season most
 * needs separated: one who played three thousand minutes and was rested for a dead rubber, and one
 * who barely featured. Their rolling five-appearance form is identical — both blank — and the rate
 * is undefined or noisy for the second. Minutes, starts and appearances are what tell them apart.
 */
interface LastSeason {
  season: string;
  points: number;
  minutes: number;
  starts: number;
  matches: number;
  appearances: number;
}

interface Accumulator {
  minutes: number;
  starts: number;
  /**
   * Matches in which `starts` was RECORDED — the denominator the start rate needs.
   *
   * Before 2022-23 the archive has no `starts` column. Dividing starts by `matches` across a career
   * that straddles that boundary computes a rate over seasons of missing numerators and reports a
   * decade-long starter as a permanent substitute. Same shape as `defconMinutes`.
   */
  startMatches: number;
  /** appearances (minutes > 0) among those same rows — the numerator side of the sub rate */
  startAppearances: number;
  /** every row, including unused-sub zeros — NOT an appearance count. See `appearances`. */
  matches: number;
  /** rows with minutes > 0 — the appearance count B-010's floor is defined on */
  appearances: number;
  xg: number;
  xa: number;
  /** minutes played in rows where expected goals were RECORDED — the per-90 denominator for xg/xa */
  xgMinutes: number;
  defcon: number;
  defconMinutes: number;
  saves: number;
  bps: number;
  points: number;
  /** (round, points, minutes) for the trailing-form window */
  recent: { round: number; points: number }[];
}

const empty = (): Accumulator => ({
  minutes: 0,
  starts: 0,
  startMatches: 0,
  startAppearances: 0,
  matches: 0,
  appearances: 0,
  xg: 0,
  xa: 0,
  xgMinutes: 0,
  defcon: 0,
  defconMinutes: 0,
  saves: 0,
  bps: 0,
  points: 0,
  recent: [],
});

/**
 * FPL's `form` is points per match over the trailing 30 days. Rounds are weekly, so four rounds is
 * the closest a round-indexed archive can express it — stated here rather than silently assumed to be
 * the same thing.
 */
const FORM_ROUNDS = 4;

/** Minutes of a player's own data before their rates are trusted over the positional average. */
const RATE_SHRINK_MINUTES = 270;

/** One row with everything that was knowable before its round, computed AT that round. */
export interface ScoredRow {
  row: HistoryRow;
  features: PlayerFeatures;
  goalRates: GoalRates;
}

export interface RoundContext {
  season: string;
  round: number;
  league: League;
  items: ScoredRow[];
  /**
   * The next rounds of the same season, scored with the state **as it stands before this round** —
   * the horizon a decision taken at this deadline could actually see.
   *
   * Empty unless the caller asks for a horizon. A transfer is a bet about the future, so a planner
   * needs several rounds of projections at one deadline; taking them from a later round's own
   * context would hand it features built from rounds that had not been played when the decision was
   * made. That is the leak plan 010's invariant 2 exists for, and it produces no error and nothing
   * wrong-looking in the output.
   *
   * What IS knowable at this deadline and is therefore used: each future row's opponent, and whether
   * it is at home. Fixtures are published in advance; results are not.
   */
  future: { round: number; items: ScoredRow[] }[];
}

export interface WalkOptions {
  /**
   * How many rounds to score at each deadline, this one included. 1 (the default) is the plain walk.
   *
   * Costs a full feature pass per extra round, so it is opt-in: the calibration reports need one
   * round and the transfer harness needs five.
   */
  horizon?: number;
}

/**
 * Walk the rows in order, yielding each round with the features that were knowable before it.
 *
 * The caller scores the round's rows and moves on; folding the round into the accumulators happens
 * afterwards, which is the whole guarantee.
 */
export function* walkRounds(
  rows: HistoryRow[],
  params: FittedParams,
  options: WalkOptions = {},
): Generator<RoundContext> {
  const horizon = Math.max(1, Math.floor(options.horizon ?? 1));
  const sorted = [...rows].sort(
    (a, b) => a.season.localeCompare(b.season) || a.round - b.round,
  );
  // Rounds are looked up by key rather than by walking forward from `i`, because a horizon runs off
  // the end of a season and a double gameweek puts two rows of one player in one round.
  const byRound = new Map<string, HistoryRow[]>();
  if (horizon > 1) {
    for (const row of sorted) {
      const key = `${row.season}|${row.round}`;
      const at = byRound.get(key);
      if (at) at.push(row);
      else byRound.set(key, [row]);
    }
  }

  /** playerCode → career accumulator, carried across seasons */
  const career = new Map<number, Accumulator>();
  /** playerCode → the accumulator for the season that has just ended */
  const lastSeason = new Map<number, LastSeason>();
  /** current-season strength inputs, reset when the season turns over */
  let strengthRows: StrengthInputRow[] = [];
  let league = buildLeague([]);
  let currentSeason: string | null = null;
  /** playerCode → accumulator within the current season only */
  let seasonAcc = new Map<number, Accumulator>();

  let i = 0;
  while (i < sorted.length) {
    const season = sorted[i].season;
    const round = sorted[i].round;

    if (season !== currentSeason) {
      // Season rollover: last season's totals become priors, and strength starts from nothing —
      // clubs are promoted and relegated and squads turn over, so carrying strength across is a
      // claim the data does not support.
      if (currentSeason !== null) {
        lastSeason.clear();
        for (const [code, acc] of seasonAcc) {
          lastSeason.set(code, {
            season: currentSeason,
            points: acc.points,
            minutes: acc.minutes,
            starts: acc.starts,
            matches: acc.matches,
            appearances: acc.appearances,
          });
        }
      }
      seasonAcc = new Map();
      strengthRows = [];
      league = buildLeague([]);
      currentSeason = season;
    }

    const roundRows: HistoryRow[] = [];
    while (
      i < sorted.length &&
      sorted[i].season === season &&
      sorted[i].round === round
    ) {
      roundRows.push(sorted[i]);
      i++;
    }

    // Features are computed HERE, before the round is folded in, and handed over as data.
    //
    // They used to be a closure over the live accumulators, which meant a caller who collected the
    // contexts and read them after the walk finished got features that included the very round they
    // were predicting — a leak that produced no error and no wrong-looking output. Computing eagerly
    // makes the guarantee structural: there is no way to ask this object a question about a later
    // state, because it holds values rather than a reference to the walk.
    const items: ScoredRow[] = roundRows.map((row) => ({
      row,
      features: featuresFor(row, career, seasonAcc, lastSeason, round),
      goalRates: fixtureGoalRates(
        row.teamCode === null ? undefined : league.teams.get(row.teamCode),
        row.opponentTeamCode === null
          ? undefined
          : league.teams.get(row.opponentTeamCode),
        row.wasHome,
        league,
        params.strength,
      ),
    }));

    // Scored with the accumulators as they stand NOW — before this round is folded in — and with the
    // form window of THIS deadline rather than of the future round, because rounds between the two
    // have not been played. Only the fixture (opponent, home) comes from the future row.
    const future: RoundContext['future'] = [];
    for (let ahead = 1; ahead < horizon; ahead++) {
      const rowsAhead = byRound.get(`${season}|${round + ahead}`);
      if (!rowsAhead) continue;
      future.push({
        round: round + ahead,
        items: rowsAhead.map((row) => ({
          row,
          features: featuresFor(row, career, seasonAcc, lastSeason, round),
          goalRates: fixtureGoalRates(
            row.teamCode === null ? undefined : league.teams.get(row.teamCode),
            row.opponentTeamCode === null
              ? undefined
              : league.teams.get(row.opponentTeamCode),
            row.wasHome,
            league,
            params.strength,
          ),
        })),
      });
    }

    yield { season, round, league, items, future };

    // Only now does this round become visible to anything.
    for (const row of roundRows) {
      fold(career, row);
      fold(seasonAcc, row);
      strengthRows.push({
        teamCode: row.teamCode,
        opponentTeamCode: row.opponentTeamCode,
        fixtureKey: `${row.season}|${row.round}|${row.fixture}`,
        // Seasons before 2022-23 have no expected goals. Team strength blends xG with goals by a
        // fitted weight, so leaving xG at zero for those seasons would halve every club's rating;
        // the goals actually scored stand in instead. Both are on the same scale, and the
        // substitution is explicit rather than a zero pretending to be a measurement.
        expectedGoals: row.expectedGoals ?? row.goalsScored,
        goalsScored: row.goalsScored,
        ownGoals: row.ownGoals,
        round: row.round,
      });
    }
    // Built AS OF the round after the one just folded in, which is the round it will be asked about.
    // The decay is a function of that distance, so passing the wrong reference round would weight
    // every match by one round too many and no output would look wrong.
    league = buildLeague(
      strengthRows,
      round + 1,
      params.strength.decayHalfLife,
    );
  }
}

function fold(acc: Map<number, Accumulator>, row: HistoryRow): void {
  let a = acc.get(row.playerCode);
  if (!a) acc.set(row.playerCode, (a = empty()));
  a.minutes += row.minutes;
  // Absent is not zero. A row from a season with no `starts` column contributes to neither the
  // numerator nor the denominator, so the rate describes the seasons that actually recorded it.
  if (row.starts !== null) {
    a.starts += row.starts;
    a.startMatches += 1;
    if (row.minutes > 0) a.startAppearances += 1;
  }
  a.matches += 1;
  if (row.minutes > 0) a.appearances += 1;
  if (row.expectedGoals !== null) {
    a.xg += row.expectedGoals;
    a.xa += row.expectedAssists ?? 0;
    a.xgMinutes += row.minutes;
  }
  a.saves += row.saves;
  a.bps += row.bps;
  a.points += row.totalPoints;
  if (row.defensiveContribution !== null) {
    a.defcon += row.defensiveContribution;
    a.defconMinutes += row.minutes;
  }
  a.recent.push({ round: row.round, points: row.totalPoints });
  if (a.recent.length > FORM_ROUNDS * 2) a.recent.shift();
}

function featuresFor(
  row: HistoryRow,
  career: Map<number, Accumulator>,
  seasonAcc: Map<number, Accumulator>,
  lastSeason: Map<number, LastSeason>,
  round: number,
): PlayerFeatures {
  const c = career.get(row.playerCode) ?? empty();
  const s = seasonAcc.get(row.playerCode) ?? empty();

  // Rates from the whole career so far, shrunk toward the positional mean while the sample is thin.
  // A promoted-club player or a new signing has nothing, and gets the positional mean rather than a
  // rate invented from three appearances.
  const mins = Math.max(c.minutes, 0);
  const weight = mins / (mins + RATE_SHRINK_MINUTES);
  const league = LEAGUE_RATES[row.position];

  const per90 = (total: number, minutes: number) =>
    minutes > 0 ? (total / minutes) * 90 : 0;

  // xG and xA are divided by the minutes in which they were RECORDED, and shrunk on that same
  // sample. Using `mins` would spread six seasons of missing chance data across the denominator and
  // report every pre-2022 career as chanceless.
  const xgWeight = c.xgMinutes / (c.xgMinutes + RATE_SHRINK_MINUTES);
  const rates: PlayerRates = {
    xg90: blend(per90(c.xg, c.xgMinutes), league.xg90, xgWeight),
    xa90: blend(per90(c.xa, c.xgMinutes), league.xa90, xgWeight),
    defcon90: blend(
      per90(c.defcon, c.defconMinutes),
      league.defcon90,
      c.defconMinutes / (c.defconMinutes + RATE_SHRINK_MINUTES),
    ),
    saves90: blend(per90(c.saves, mins), league.saves90, weight),
    bps90: blend(per90(c.bps, mins), league.bps90, weight),
  };

  const recent = s.recent.filter((r) => r.round >= round - FORM_ROUNDS);
  const form =
    recent.length > 0
      ? recent.reduce((t, r) => t + r.points, 0) / recent.length
      : null;

  const prior = lastSeason.get(row.playerCode);

  return {
    rates,
    // A player with no history at all is assumed a squad player rather than a starter — the
    // alternative, assuming they start, is what makes a model recommend every new signing.
    // Denominated on matches where `starts` was recorded, so a career that straddles 2022-23 is
    // rated on the half of it the archive actually describes rather than diluted by the half it
    // does not.
    laggedStartRate:
      s.startMatches > 0
        ? s.starts / s.startMatches
        : c.startMatches > 0
          ? c.starts / c.startMatches
          : 0.3,
    laggedSubRate: laggedSubRate(s, c),
    minutesSample: mins,
    matchesSample: c.matches,
    appearancesSample: c.appearances,
    form,
    priorSeasonPointsPer90:
      prior && prior.minutes >= 450
        ? (prior.points / prior.minutes) * 90
        : null,
    // No minutes floor on these three. The floor on the rate above exists because a rate over 200
    // minutes is noise; a COUNT of 200 minutes is not noise, it is the fact that he barely played,
    // and gating it away would discard exactly the signal these terms are here for.
    priorSeasonMinutes: prior ? prior.minutes : null,
    priorSeasonStartRate:
      prior && prior.matches > 0 ? prior.starts / prior.matches : null,
    priorSeasonAppearances: prior ? prior.appearances : null,
    priorSeasonGap: prior ? seasonGap(prior.season, row.season) : null,
  };
}

/**
 * How many seasons apart two archive season labels are ("2023-24" and "2025-26" are two).
 *
 * Returns null rather than guessing when a label is not the archive's shape — a wrong gap is worse
 * than an absent one, because absent is a value the model already knows how to handle.
 */
function seasonGap(from: string, to: string): number | null {
  const start = (label: string): number | null => {
    const m = /^(\d{4})-\d{2}$/.exec(label);
    return m ? Number(m[1]) : null;
  };
  const a = start(from);
  const b = start(to);
  return a === null || b === null ? null : b - a;
}

function blend(own: number, league: number, weight: number): number {
  return weight * own + (1 - weight) * league;
}

/**
 * The population rate a thin sub-appearance record is shrunk toward, and how much shrinking it takes.
 *
 * The prior is the same quantity `fitted.ts` calls `subAppearanceRate` — the league-wide share of
 * non-starts that became appearances. It is written here as a constant rather than threaded through
 * from the fitted parameters on purpose: this is a SMOOTHING target, not a model parameter, and the
 * feature has to be identical between the run that fits the curve and the run that serves it. A
 * smoothing target that moves with the fit makes the fitted curve a function of its own output.
 */
const SUB_RATE_PRIOR = 0.15;
/** Non-starts before a player's own rate outweighs the prior — a Beta(k) pseudo-count. */
const SUB_RATE_SHRINK = 8;

/**
 * `P(appeared | did not start)` from what is already folded in, this season first and career behind.
 *
 * Season first for the same reason `laggedStartRate` is: a role changes between seasons, and last
 * year's super-sub may be this year's starter or this year's out-of-favour. The career record is the
 * fallback while the season is young, and the prior is the fallback behind that.
 */
function laggedSubRate(season: Accumulator, career: Accumulator): number {
  // Denominated on the rows that RECORDED a start, not on every row. `matches - starts` over a
  // career that straddles 2022-23 counts seven seasons of unrecorded starts as non-starts, and
  // `appearances - starts` counts every one of those appearances as a substitute appearance — so a
  // decade-long ever-present comes out as a career benchwarmer.
  const pick =
    season.startMatches - season.starts >= SUB_RATE_SHRINK ? season : career;
  const nonStarts = Math.max(0, pick.startMatches - pick.starts);
  const subAppearances = Math.max(0, pick.startAppearances - pick.starts);
  return (
    (subAppearances + SUB_RATE_PRIOR * SUB_RATE_SHRINK) /
    (nonStarts + SUB_RATE_SHRINK)
  );
}

/**
 * Positional means, the shrinkage target for a player with no history.
 *
 * Deliberately modest numbers: the target for an unknown player should look like a squad player, not
 * like the average of the players who actually accumulate minutes. Recomputed by `pnpm fit:model` and
 * reported alongside the fit.
 */
const LEAGUE_RATES: Record<
  PositionCode,
  {
    xg90: number;
    xa90: number;
    defcon90: number;
    saves90: number;
    bps90: number;
  }
> = {
  GKP: { xg90: 0, xa90: 0.01, defcon90: 0, saves90: 3.0, bps90: 18 },
  DEF: { xg90: 0.05, xa90: 0.06, defcon90: 7.5, saves90: 0, bps90: 16 },
  MID: { xg90: 0.15, xa90: 0.13, defcon90: 8.0, saves90: 0, bps90: 15 },
  FWD: { xg90: 0.33, xa90: 0.14, defcon90: 5.0, saves90: 0, bps90: 16 },
};
