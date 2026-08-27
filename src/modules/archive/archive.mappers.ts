import { PositionCode } from '../fpl-sync/mappers';
import { bool, int, intOrNull, num } from './csv';

/**
 * Archive CSV rows → the shape `archive_player_gameweek` stores.
 *
 * Pure functions, no DB and no network, so the season-shape differences below are unit-testable
 * against recorded rows rather than discovered during a 87,000-row import.
 *
 * The seasons are not the same shape:
 *   2023-24, 2024-25 — no defensive contribution at all (the category did not exist)
 *   2025-26          — defensive_contribution plus its components (CBI, tackles, recoveries)
 * A missing column is NULL, never 0. "The category did not exist" and "the player did nothing" are
 * different facts, and a fit that reads them as the same one learns that defenders stopped tackling.
 */

export const ARCHIVE_SEASONS = ['2023-24', '2024-25', '2025-26'] as const;
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
  starts: number;
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
  expectedGoals: number;
  expectedAssists: number;
  expectedGoalsConceded: number;
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
): ArchiveGameweekRow | null {
  const element = int(rec, 'element');
  const playerCode = codeOf.get(element);
  if (playerCode === undefined) return null;

  const label = (rec.position ?? '').trim();
  const position = POSITION_BY_ARCHIVE_LABEL[label];
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
    starts: intOrNull(rec, 'starts') ?? 0,
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

    expectedGoals: num(rec, 'expected_goals') ?? 0,
    expectedAssists: num(rec, 'expected_assists') ?? 0,
    expectedGoalsConceded: num(rec, 'expected_goals_conceded') ?? 0,
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
