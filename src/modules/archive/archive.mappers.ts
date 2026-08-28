import { PositionCode } from '../fpl-sync/mappers';
import { bool, int, intOrNull, num } from './csv';

/**
 * Archive CSV rows → the shape `archive_player_gameweek` stores.
 *
 * Pure functions, no DB and no network, so the season-shape differences below are unit-testable
 * against recorded rows rather than discovered during a 250,000-row import.
 *
 * The seasons are not the same shape, and the differences run deeper the further back you go:
 *   2016-17 … 2018-19 — no `position` and no `team` column; both come from `players_raw.csv`
 *   2016-17 … 2021-22 — no `starts`
 *   2016-17 … 2021-22 — no expected goals, assists or goals conceded
 *   2016-17 … 2018-19 — no `teams.csv` at all; the club code comes from `players_raw.team_code`
 *   2023-24, 2024-25  — no defensive contribution (the category did not exist)
 *   2025-26           — defensive_contribution plus its components (CBI, tackles, recoveries)
 *
 * A missing column is NULL, never 0. "The category did not exist" and "the player did nothing" are
 * different facts, and a fit that reads them as the same one learns that defenders stopped tackling
 * — or, for the columns added below, that nobody started a match or generated a chance before 2022.
 */

export const ARCHIVE_SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
  '2023-24',
  '2024-25',
  '2025-26',
] as const;
export type ArchiveSeason = (typeof ARCHIVE_SEASONS)[number];

export interface ArchiveGameweekRow {
  season: string;
  round: number;
  fixture: number;
  playerCode: number;
  webName: string;
  position: PositionCode;
  teamCode: number | null;
  opponentTeamCode: number | null;
  wasHome: boolean;
  kickoffTime: Date | null;
  minutes: number;
  /** null before 2022-23 — not recorded. NOT the same as "did not start". */
  starts: number | null;
  totalPoints: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  ownGoals: number;
  penaltiesSaved: number;
  penaltiesMissed: number;
  yellowCards: number;
  redCards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensiveContribution: number | null;
  clearancesBlocksInterceptions: number | null;
  tackles: number | null;
  recoveries: number | null;
  /** null before 2022-23 — the category did not exist in the archive */
  expectedGoals: number | null;
  expectedAssists: number | null;
  expectedGoalsConceded: number | null;
  ictIndex: number;
  /** the ICT split (B-037): null when the CSV lacks the column, never invented as zero */
  influence: number | null;
  creativity: number | null;
  threat: number | null;
  value: number;
  selectedBy: number;
}

/** `players_raw.csv` for one season: the per-season `element` id ↔ the stable `code`. */
export function elementToCode(
  playersRaw: Record<string, string>[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of playersRaw) map.set(int(r, 'id'), int(r, 'code'));
  return map;
}

/** `players_raw.csv`: the per-season `element` id → that season's team id. */
/**
 * `players_raw.csv`: the per-season `element` id → position.
 *
 * The only source before 2020-21, whose `merged_gw.csv` carries no `position` column at all. Read
 * from `element_type`, which every season has had.
 */
export function elementToPosition(
  playersRaw: Record<string, string>[],
): Map<number, PositionCode> {
  const byType: Record<number, PositionCode> = {
    1: 'GKP',
    2: 'DEF',
    3: 'MID',
    4: 'FWD',
  };
  const map = new Map<number, PositionCode>();
  for (const r of playersRaw) {
    const pos = byType[int(r, 'element_type')];
    if (pos) map.set(int(r, 'id'), pos);
  }
  return map;
}

export function elementToTeamId(
  playersRaw: Record<string, string>[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of playersRaw) map.set(int(r, 'id'), int(r, 'team'));
  return map;
}

/** `teams.csv` for one season: that season's 1-20 team id ↔ the stable club `code`. */
export function teamIdToCode(
  teams: Record<string, string>[],
): Map<number, number> {
  const map = new Map<number, number>();
  for (const r of teams) map.set(int(r, 'id'), int(r, 'code'));
  return map;
}

/**
 * The archive's position labels are NOT ours.
 *
 * It writes `GK` where we write `GKP` — checked across all three seasons, and every one of them uses
 * `GK` exclusively (3,413 / 2,869 / 3,427 rows). Matching on `GKP` silently drops every goalkeeper,
 * which is the position whose scoring behaves least like the others and the one a fit can least
 * afford to lose.
 *
 * `AM` is the Assistant Manager element FPL ran in 2024-25 (322 rows). Not a player, not scored like
 * one, and excluded rather than mapped — the importer counts what it excludes.
 */
const POSITION_BY_ARCHIVE_LABEL: Record<string, PositionCode> = {
  GK: 'GKP',
  GKP: 'GKP',
  DEF: 'DEF',
  MID: 'MID',
  FWD: 'FWD',
};

export const EXCLUDED_POSITION_LABELS = new Set(['AM', 'MNG']);

/**
 * One `gws/gw{n}.csv` row.
 *
 * Returns null for a row that cannot be identified — an `element` absent from that season's
 * `players_raw.csv`, or a position label that is not a player (`AM`). The caller counts every null
 * and reports it; a row is never silently dropped.
 *
 * `xP` is deliberately not read. It is post-match contaminated — see the schema comment on
 * `ArchivePlayerGameweek`.
 */
export function mapArchiveRow(
  rec: Record<string, string>,
  season: string,
  codeOf: Map<number, number>,
  teamCodeOfElement: (element: number) => number | null,
  teamCodeOfSeasonId: (seasonTeamId: number) => number | null,
  positionOfElement?: Map<number, PositionCode>,
): ArchiveGameweekRow | null {
  const element = int(rec, 'element');
  const playerCode = codeOf.get(element);
  if (playerCode === undefined) return null;

  // Before 2020-21 there is no `position` column, so the season's own `players_raw.element_type` is
  // the only source. An unrecognised LABEL is still a rejection — `AM`/`MNG` are not players — but
  // an ABSENT column is not a rejection, it is an older season.
  const label = (rec.position ?? '').trim();
  if (label && EXCLUDED_POSITION_LABELS.has(label)) return null;
  const position = label
    ? POSITION_BY_ARCHIVE_LABEL[label]
    : positionOfElement?.get(element);
  if (!position) return null;

  const kickoff = rec.kickoff_time?.trim();

  return {
    season,
    round: int(rec, 'round'),
    fixture: int(rec, 'fixture'),
    playerCode,
    webName: rec.name ?? '',
    position,
    teamCode: teamCodeOfElement(element),
    opponentTeamCode: teamCodeOfSeasonId(int(rec, 'opponent_team')),
    wasHome: bool(rec, 'was_home'),
    kickoffTime: kickoff ? new Date(kickoff) : null,
    minutes: int(rec, 'minutes'),
    // NOT `?? 0`. Before 2022-23 the archive has no `starts` column, and defaulting it to zero
    // tells the minutes model that every player in six seasons came off the bench.
    starts: intOrNull(rec, 'starts'),
    totalPoints: int(rec, 'total_points'),
    goalsScored: int(rec, 'goals_scored'),
    assists: int(rec, 'assists'),
    cleanSheets: int(rec, 'clean_sheets'),
    goalsConceded: int(rec, 'goals_conceded'),
    ownGoals: int(rec, 'own_goals'),
    penaltiesSaved: int(rec, 'penalties_saved'),
    penaltiesMissed: int(rec, 'penalties_missed'),
    yellowCards: int(rec, 'yellow_cards'),
    redCards: int(rec, 'red_cards'),
    saves: int(rec, 'saves'),
    bonus: int(rec, 'bonus'),
    bps: int(rec, 'bps'),

    // Absent before 2025-26. NULL, not 0.
    defensiveContribution: intOrNull(rec, 'defensive_contribution'),
    clearancesBlocksInterceptions: intOrNull(
      rec,
      'clearances_blocks_interceptions',
    ),
    tackles: intOrNull(rec, 'tackles'),
    recoveries: intOrNull(rec, 'recoveries'),

    // NOT `?? 0`, for the same reason: absent before 2022-23, and a zero here is a claim that no
    // chance was created in the league that season.
    expectedGoals: num(rec, 'expected_goals'),
    expectedAssists: num(rec, 'expected_assists'),
    expectedGoalsConceded: num(rec, 'expected_goals_conceded'),
    ictIndex: num(rec, 'ict_index') ?? 0,
    influence: num(rec, 'influence'),
    creativity: num(rec, 'creativity'),
    threat: num(rec, 'threat'),
    value: int(rec, 'value'),
    selectedBy: intOrNull(rec, 'selected') ?? 0,
  };
}

/**
 * The defensive-contribution count, recomputed from its components.
 *
 * The column is a COUNT of qualifying actions, not points — read as points it awards 2 to anyone who
 * made a single tackle. The formula is position-dependent:
 *
 *   DEF      clearances+blocks+interceptions + tackles
 *   MID/FWD  the same, plus recoveries
 *   GKP      **always 0** — the category does not apply to goalkeepers, so their count stays 0 even
 *            when they clear and tackle. Upstream confirms it twice over: every GKP in GW1 2026/27
 *            has a count of 0 while making the actions, and `game_config.scoring` prices the category
 *            at 0 for GKP. Summing the components for a keeper is what the archive import caught on
 *            its first run.
 */
export function expectedDefconCount(
  position: PositionCode,
  cbi: number,
  tackles: number,
  recoveries: number,
): number {
  if (position === 'GKP') return 0;
  return cbi + tackles + (position === 'DEF' ? 0 : recoveries);
}
