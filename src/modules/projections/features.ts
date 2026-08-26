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
  starts: number;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  bonus: number;
  bps: number;
  defensiveContribution: number | null;
  expectedGoals: number;
  expectedAssists: number;
  value: number;
}

/** What the model is allowed to know about a player before a round it has not seen. */
export interface PlayerFeatures {
  rates: PlayerRates;
  laggedStartRate: number;
  /** appearances the rates rest on — thin samples are shrunk, and the report says how thin */
  minutesSample: number;
  matchesSample: number;
  /** trailing-30-day points per match, recomputed rather than read: the archive has no `form` column */
  form: number | null;
  /** previous season's points per 90, the other baseline */
  priorSeasonPointsPer90: number | null;
}

interface Accumulator {
  minutes: number;
  starts: number;
  matches: number;
  xg: number;
  xa: number;
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
  matches: 0,
  xg: 0,
  xa: 0,
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
): Generator<RoundContext> {
  const sorted = [...rows].sort(
    (a, b) => a.season.localeCompare(b.season) || a.round - b.round,
  );

  /** playerCode → career accumulator, carried across seasons */
  const career = new Map<number, Accumulator>();
  /** playerCode → the accumulator for the season that has just ended */
  const lastSeason = new Map<number, { points: number; minutes: number }>();
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
          lastSeason.set(code, { points: acc.points, minutes: acc.minutes });
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

    yield { season, round, league, items };

    // Only now does this round become visible to anything.
    for (const row of roundRows) {
      fold(career, row);
      fold(seasonAcc, row);
      strengthRows.push({
        teamCode: row.teamCode,
        opponentTeamCode: row.opponentTeamCode,
        fixtureKey: `${row.season}|${row.round}|${row.fixture}`,
        expectedGoals: row.expectedGoals,
      });
    }
    league = buildLeague(strengthRows);
  }
}

function fold(acc: Map<number, Accumulator>, row: HistoryRow): void {
  let a = acc.get(row.playerCode);
  if (!a) acc.set(row.playerCode, (a = empty()));
  a.minutes += row.minutes;
  a.starts += row.starts;
  a.matches += 1;
  a.xg += row.expectedGoals;
  a.xa += row.expectedAssists;
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
  lastSeason: Map<number, { points: number; minutes: number }>,
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

  const rates: PlayerRates = {
    xg90: blend(per90(c.xg, mins), league.xg90, weight),
    xa90: blend(per90(c.xa, mins), league.xa90, weight),
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
    laggedStartRate: s.matches > 0 ? s.starts / s.matches : c.matches > 0 ? c.starts / c.matches : 0.3,
    minutesSample: mins,
    matchesSample: c.matches,
    form,
    priorSeasonPointsPer90:
      prior && prior.minutes >= 450 ? (prior.points / prior.minutes) * 90 : null,
  };
}

function blend(own: number, league: number, weight: number): number {
  return weight * own + (1 - weight) * league;
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
  { xg90: number; xa90: number; defcon90: number; saves90: number; bps90: number }
> = {
  GKP: { xg90: 0, xa90: 0.01, defcon90: 0, saves90: 3.0, bps90: 18 },
  DEF: { xg90: 0.05, xa90: 0.06, defcon90: 7.5, saves90: 0, bps90: 16 },
  MID: { xg90: 0.15, xa90: 0.13, defcon90: 8.0, saves90: 0, bps90: 15 },
  FWD: { xg90: 0.33, xa90: 0.14, defcon90: 5.0, saves90: 0, bps90: 16 },
};
