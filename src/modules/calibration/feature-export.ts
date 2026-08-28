import { FittedParams } from '../projections/fitted';
import { HistoryRow, walkRounds } from '../projections/features';
import { minutesDistribution } from '../projections/model-v2';
import { projectFixtureV2 } from '../projections/model-v2';
import { Scoring } from '../projections/scoring';

/**
 * B-034 — the leak-safe feature matrix the v4 gradient-boosted candidate trains on.
 *
 * ## One time cut, inherited rather than reimplemented
 *
 * Every leak this project has paid for was a second implementation of the time cut, and a fresh
 * SQL or Python exporter would be exactly that. So this exporter is a CONSUMER of `walkRounds`:
 * contexts arrive in walk order, and the exporter's own window store is appended to only AFTER a
 * context's rows have been emitted. It cannot see a future match because the generator has not
 * yielded it yet — the cut is the generator's, not this file's. The one piece of ordering this file
 * owns (emit, then append) is a single loop, and the sabotage tests break it on purpose.
 *
 * ## What a row is
 *
 * One row per player per FIXTURE — a double gameweek is two rows, exactly as the archive keys it —
 * carrying:
 *   - v3's own leak-safe features (start/sub rates, form, prior season, samples) and the fixture
 *     goal rates, straight off the context;
 *   - mean aggregates over the player's 1/3/5/10/38 most recent MATCHES (not rounds) of the OpenFPL
 *     player feature group;
 *   - the same windows over the player's team and opponent (goals and xG, for and against);
 *   - the target: the row's own `totalPoints`.
 *
 * A window with no history emits empty cells, which the training side reads as missing — XGBoost
 * handles missing natively, and a sentinel would teach the trees that "no history" is a number.
 */

export const WINDOWS = [1, 3, 5, 10, 38] as const;

/** The per-match player observation the windows aggregate over. */
interface PlayerMatch {
  points: number;
  minutes: number;
  started: number | null;
  goals: number;
  assists: number;
  conceded: number;
  cleanSheet: number;
  saves: number;
  bonus: number;
  bps: number;
  xg: number | null;
  xa: number | null;
  xgc: number | null;
  ict: number;
  defcon: number;
  influence: number | null;
  creativity: number | null;
  threat: number | null;
}

/**
 * Fields that can be null per match. Their windows average the matches that HAVE the value and go
 * missing when none do, so a season with the field and one without do not blend a real number with
 * an invented zero.
 *
 * The I/C/T split arrived in B-037. `started`, `xg`, `xa` and `xgc` joined them when the archive was
 * extended back to 2016-17: none of the four exists before 2022-23, and a window that averaged them
 * as zeros would report six seasons of substitutes who never had a shot.
 */
const NULLABLE_PLAYER_FIELDS = [
  'influence',
  'creativity',
  'threat',
  'started',
  'xg',
  'xa',
  'xgc',
] as const;

const PLAYER_FIELDS = [
  'points',
  'minutes',
  'goals',
  'assists',
  'conceded',
  'cleanSheet',
  'saves',
  'bonus',
  'bps',
  'ict',
  'defcon',
] as const;

/** The per-match team observation. Rolled up from player rows exactly as `strength.ts` defines it. */
interface TeamMatch {
  goalsFor: number;
  goalsAgainst: number;
  /** null for a season the archive has no expected goals for, same rule as the player fields */
  xgFor: number | null;
  xgAgainst: number | null;
}

const TEAM_FIELDS = ['goalsFor', 'goalsAgainst', 'xgFor', 'xgAgainst'] as const;

const mean = (xs: number[]): number =>
  xs.reduce((s, x) => s + x, 0) / xs.length;

/** Mean over the non-null values in the last `n` of `hist`, or null when none carry the field. */
function nullableWindowMean<T>(
  hist: T[],
  n: number,
  pick: (t: T) => number | null,
): number | null {
  const xs = hist
    .slice(-n)
    .map(pick)
    .filter((x): x is number => x !== null);
  return xs.length ? mean(xs) : null;
}

/** Mean over the last `n` of `hist`, or null when there is no history at all. */
function windowMean<T>(
  hist: T[],
  n: number,
  pick: (t: T) => number,
): number | null {
  if (hist.length === 0) return null;
  return mean(hist.slice(-n).map(pick));
}

export interface ExportedRow {
  /** identity — not features */
  season: string;
  round: number;
  fixture: number;
  playerCode: number;
  position: string;
  /** the target */
  totalPoints: number;
  /** realised minutes — identity, never a feature: the fit needs it to build return categories */
  minutes: number;
  /**
   * The incumbent's own expected points for this row, from the same deadline-time features (B-037
   * increment 2). Doubles as a feature and as the base of the residual target: the fit trains on
   * `totalPoints − v3ep` and the final prediction is `v3ep + correction`, so the decomposed model
   * keeps pricing what it prices exactly — the 2-point appearance band — and the trees learn only
   * what it gets wrong.
   */
  v3ep: number;
  /** feature name → value; null = missing */
  features: Map<string, number | null>;
}

export function featureNames(): string[] {
  const names: string[] = [
    'v3ep',
    'value',
    'wasHome',
    'laggedStartRate',
    'laggedSubRate',
    'form',
    'priorSeasonPointsPer90',
    'priorSeasonMinutes',
    'priorSeasonStartRate',
    'priorSeasonAppearances',
    'priorSeasonGap',
    'appearancesSample',
    'matchesSample',
    'lambdaFor',
    'lambdaAgainst',
  ];
  for (const f of PLAYER_FIELDS)
    for (const w of WINDOWS) names.push(`p_${f}_${w}`);
  for (const f of NULLABLE_PLAYER_FIELDS)
    for (const w of WINDOWS) names.push(`p_${f}_${w}`);
  for (const f of TEAM_FIELDS)
    for (const w of WINDOWS) names.push(`t_${f}_${w}`);
  for (const f of TEAM_FIELDS)
    for (const w of WINDOWS) names.push(`o_${f}_${w}`);
  return names;
}

/**
 * Walk the archive and emit one feature row per scoreable player-fixture.
 *
 * `evaluate` mirrors `runBacktest`'s: rows outside it still feed the windows (they are history) but
 * are not emitted. Rows the model itself would skip (no prior appearance, missing team codes) are
 * skipped here too, so the exported population is the population the incumbent is scored on.
 */
export function exportFeatures(
  rows: HistoryRow[],
  params: FittedParams,
  /** per-season scoring, for the incumbent's EP — the same resolver every calibration run uses */
  scoringFor: (season: string) => Scoring,
  evaluate: (row: HistoryRow) => boolean = () => true,
  /**
   * Let the walk read imputed start probabilities (B-040, plan 027 task 7).
   *
   * Default off, so the exporter reproduces the three-season export byte for byte. On, the seasons
   * before 2023-24 carry a usable `laggedStartRate` for the first time — without it their rows have
   * no start history at all and `v3ep` is a number computed from nothing, which is worse for a
   * gradient-boosted model than not having the row.
   */
  imputedStarts = false,
): ExportedRow[] {
  const out: ExportedRow[] = [];

  /** playerCode → matches so far, oldest first. Appended AFTER a round is emitted. */
  const playerHist = new Map<number, PlayerMatch[]>();
  /** teamCode → team-matches so far, oldest first. */
  const teamHist = new Map<number, TeamMatch[]>();
  let currentSeason: string | null = null;

  for (const context of walkRounds(rows, params, { imputedStarts })) {
    // Season rollover: windows do not cross seasons — promotion, relegation and squad turnover make
    // a 38-match window spanning two seasons a claim the data does not support. `walkRounds` makes
    // the same call for team strength.
    if (context.season !== currentSeason) {
      playerHist.clear();
      teamHist.clear();
      currentSeason = context.season;
    }

    // --- EMIT, from history that ends strictly before this round.
    for (const { row, features, goalRates } of context.items) {
      if (!evaluate(row)) continue;
      if (features.matchesSample === 0) continue;
      if (row.teamCode === null || row.opponentTeamCode === null) continue;

      // The incumbent's projection for this row — identical construction to `runBacktest`'s, from
      // the same context, so the residual base IS the number the reports score as `model`.
      const v3ep = projectFixtureV2(
        row.position,
        minutesDistribution(
          {
            startRate: features.laggedStartRate,
            subRate: features.laggedSubRate,
          },
          1,
          params,
          row.position,
        ),
        features.rates,
        goalRates,
        scoringFor(row.season),
        params,
      ).ep;

      const f = new Map<string, number | null>();
      f.set('v3ep', v3ep);
      f.set('value', row.value);
      f.set('wasHome', row.wasHome ? 1 : 0);
      f.set('laggedStartRate', features.laggedStartRate);
      f.set('laggedSubRate', features.laggedSubRate);
      f.set('form', features.form);
      f.set('priorSeasonPointsPer90', features.priorSeasonPointsPer90);
      f.set('priorSeasonMinutes', features.priorSeasonMinutes);
      f.set('priorSeasonStartRate', features.priorSeasonStartRate);
      f.set('priorSeasonAppearances', features.priorSeasonAppearances);
      f.set('priorSeasonGap', features.priorSeasonGap);
      f.set('appearancesSample', features.appearancesSample);
      f.set('matchesSample', features.matchesSample);
      f.set('lambdaFor', goalRates.lambdaFor);
      f.set('lambdaAgainst', goalRates.lambdaAgainst);

      const ph = playerHist.get(row.playerCode) ?? [];
      for (const field of PLAYER_FIELDS)
        for (const w of WINDOWS)
          f.set(
            `p_${field}_${w}`,
            windowMean(ph, w, (m) => m[field]),
          );
      for (const field of NULLABLE_PLAYER_FIELDS)
        for (const w of WINDOWS)
          f.set(
            `p_${field}_${w}`,
            nullableWindowMean(ph, w, (m) => m[field]),
          );

      // Team windows use the nullable mean throughout: two of the four fields are expected goals,
      // which no season before 2022-23 records, and averaging those as zero would make every club
      // of that era look incapable of creating a chance.
      const th = teamHist.get(row.teamCode) ?? [];
      for (const field of TEAM_FIELDS)
        for (const w of WINDOWS)
          f.set(
            `t_${field}_${w}`,
            nullableWindowMean(th, w, (m) => m[field]),
          );

      const oh = teamHist.get(row.opponentTeamCode) ?? [];
      for (const field of TEAM_FIELDS)
        for (const w of WINDOWS)
          f.set(
            `o_${field}_${w}`,
            nullableWindowMean(oh, w, (m) => m[field]),
          );

      out.push({
        season: row.season,
        round: row.round,
        fixture: row.fixture,
        playerCode: row.playerCode,
        position: row.position,
        totalPoints: row.totalPoints,
        minutes: row.minutes,
        v3ep,
        features: f,
      });
    }

    // --- APPEND, only now. This ordering is the one piece of the cut this file owns.
    //
    // The team rollup is keyed by (team, FIXTURE), not by team alone: a double-gameweek team plays
    // two matches in one round, and merging them into one team-match entry would make its windows
    // count matches on a different clock from every other team's.
    const teamAgg = new Map<
      string,
      {
        teamCode: number;
        goals: number;
        xg: number;
        oppGoals: number;
        oppXg: number;
      }
    >();
    const side = (teamCode: number, fixture: number) => {
      const key = `${teamCode}|${fixture}`;
      let agg = teamAgg.get(key);
      if (!agg) {
        agg = { teamCode, goals: 0, xg: 0, oppGoals: 0, oppXg: 0 };
        teamAgg.set(key, agg);
      }
      return agg;
    };
    for (const { row } of context.items) {
      const hist = playerHist.get(row.playerCode) ?? [];
      hist.push({
        points: row.totalPoints,
        minutes: row.minutes,
        started: row.starts,
        goals: row.goalsScored,
        assists: row.assists,
        conceded: row.goalsConceded,
        cleanSheet: row.cleanSheets,
        saves: row.saves,
        bonus: row.bonus,
        bps: row.bps,
        xg: row.expectedGoals,
        xa: row.expectedAssists,
        xgc: row.expectedGoalsConceded,
        ict: row.ictIndex,
        defcon: row.defensiveContribution ?? 0,
        influence: row.influence,
        creativity: row.creativity,
        threat: row.threat,
      });
      if (hist.length > 40) hist.shift();
      playerHist.set(row.playerCode, hist);

      // A team's goals in a fixture are its players' goals plus the opponent's own goals — the
      // scoreboard definition, same rollup as `strength.ts`. An own goal therefore counts FOR the
      // team that did not kick it and AGAINST the team that did.
      if (row.teamCode !== null && row.opponentTeamCode !== null) {
        const us = side(row.teamCode, row.fixture);
        us.goals += row.goalsScored;
        if (row.expectedGoals !== null) {
          us.xg = (us.xg ?? 0) + row.expectedGoals;
        }
        us.oppGoals += row.ownGoals;
        const them = side(row.opponentTeamCode, row.fixture);
        them.goals += row.ownGoals;
        them.oppGoals += row.goalsScored;
        if (row.expectedGoals !== null) {
          them.oppXg = (them.oppXg ?? 0) + row.expectedGoals;
        }
      }
    }
    for (const agg of teamAgg.values()) {
      const hist = teamHist.get(agg.teamCode) ?? [];
      hist.push({
        goalsFor: agg.goals,
        goalsAgainst: agg.oppGoals,
        xgFor: agg.xg,
        xgAgainst: agg.oppXg,
      });
      if (hist.length > 40) hist.shift();
      teamHist.set(agg.teamCode, hist);
    }
  }
  return out;
}

/** Render rows as CSV. Null features become empty cells — missing, not zero. */
export function toCsv(rows: ExportedRow[]): string {
  const names = featureNames();
  const header = [
    'season',
    'round',
    'fixture',
    'playerCode',
    'position',
    'totalPoints',
    'minutesActual',
    'v3epBase',
    ...names,
  ].join(',');
  const lines = rows.map((r) =>
    [
      r.season,
      r.round,
      r.fixture,
      r.playerCode,
      r.position,
      r.totalPoints,
      r.minutes,
      r.v3ep,
      ...names.map((n) => {
        const v = r.features.get(n);
        return v === null || v === undefined ? '' : String(v);
      }),
    ].join(','),
  );
  return [header, ...lines].join('\n') + '\n';
}
