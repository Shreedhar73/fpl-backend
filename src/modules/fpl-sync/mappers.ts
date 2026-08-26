/**
 * Pure functions that turn an upstream FPL object into the shape we store. Every field gotcha from
 * the `fpl-api-reference` skill is handled HERE, at the boundary, exactly once — nothing downstream
 * should ever see a raw decimal string, a tenths-vs-pounds ambiguity, or a `null` that means "fit".
 *
 * These take natural FPL ids (`teamFplId`, `playerFplId`, …), not our internal cuids: that keeps
 * them pure and unit-testable against a recorded payload with no database. The repository resolves
 * the ids to internal keys.
 */
import {
  RawTeam,
  RawElement,
  RawElementType,
  RawEvent,
  RawFixture,
  RawElementHistory,
  RawSeasonHistory,
} from '../../infra/fpl/fpl.types';

export type PositionCode = 'GKP' | 'DEF' | 'MID' | 'FWD';

export interface MappedTeam {
  fplId: number;
  code: number;
  name: string;
  shortName: string;
  strength: number;
  strengthOverallHome: number;
  strengthOverallAway: number;
  strengthAttackHome: number;
  strengthAttackAway: number;
  strengthDefenceHome: number;
  strengthDefenceAway: number;
}

export interface MappedPlayer {
  fplId: number;
  code: number;
  firstName: string;
  secondName: string;
  webName: string;
  position: PositionCode;
  teamFplId: number;
  nowCost: number;
  status: string;
  chanceOfPlayingNextRound: number | null;
  news: string | null;
  newsAddedAt: Date | null;
  // projection inputs (season-to-date, from the bootstrap element)
  form: string | null;
  pointsPerGame: string | null;
  epNext: string | null;
  epThis: string | null;
  expectedGoalsPer90: number;
  expectedAssistsPer90: number;
  expectedGoalsConcededPer90: number;
  defensiveContributionPer90: number;
  savesPer90: number;
  startsPer90: number;
  penaltiesOrder: number | null;
  directFreekicksOrder: number | null;
  cornersOrder: number | null;
  seasonMinutes: number;
  seasonStarts: number;
}

export interface MappedSeasonHistory {
  season: string;
  totalPoints: number;
  minutes: number;
  starts: number;
  goalsScored: number;
  assists: number;
  cleanSheets: number;
  goalsConceded: number;
  saves: number;
  bonus: number;
  bps: number;
  defensiveContribution: number;
  expectedGoals: string;
  expectedAssists: string;
  expectedGoalsConceded: string;
  startCost: number;
  endCost: number;
}

export interface MappedGameweek {
  id: number;
  name: string;
  deadlineTime: Date;
  finished: boolean;
  dataChecked: boolean;
  isCurrent: boolean;
  isNext: boolean;
  averageScore: number | null;
  highestScore: number | null;
}

export interface MappedFixture {
  fplId: number;
  gameweekId: number | null;
  kickoffTime: Date | null;
  homeTeamFplId: number;
  awayTeamFplId: number;
  homeScore: number | null;
  awayScore: number | null;
  homeDifficulty: number;
  awayDifficulty: number;
  started: boolean;
  finished: boolean;
}

export interface MappedOwnership {
  playerFplId: number;
  selectedByPercent: string; // decimal string, stored as Decimal
  transfersInEvent: number;
  transfersOutEvent: number;
}

export interface MappedGameweekStat {
  playerFplId: number;
  gameweekId: number;
  fixtureFplId: number;
  wasHome: boolean;
  opponentTeamFplId: number;
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
  defensiveContribution: number;
  expectedGoals: string;
  expectedAssists: string;
  expectedGoalsConceded: string;
  ictIndex: string;
  value: number; // tenths
  selectedBy: number;
}

/** `element_types` → { 1: 'GKP', 2: 'DEF', … }. `singular_name_short` already matches our enum. */
export function positionByType(
  types: RawElementType[],
): Record<number, PositionCode> {
  const map: Record<number, PositionCode> = {};
  for (const t of types) {
    map[t.id] = t.singular_name_short as PositionCode;
  }
  return map;
}

export function mapTeam(t: RawTeam): MappedTeam {
  return {
    fplId: t.id,
    code: t.code,
    name: t.name,
    shortName: t.short_name,
    // `strength` is null in preseason payloads; the column is non-null. 0 = "not yet rated".
    strength: t.strength ?? 0,
    strengthOverallHome: t.strength_overall_home,
    strengthOverallAway: t.strength_overall_away,
    strengthAttackHome: t.strength_attack_home,
    strengthAttackAway: t.strength_attack_away,
    strengthDefenceHome: t.strength_defence_home,
    strengthDefenceAway: t.strength_defence_away,
  };
}

export function mapPlayer(
  e: RawElement,
  position: Record<number, PositionCode>,
): MappedPlayer {
  const pos = position[e.element_type];
  if (!pos) {
    throw new Error(
      `unknown element_type ${e.element_type} for player ${e.id}`,
    );
  }
  return {
    fplId: e.id,
    code: e.code,
    firstName: e.first_name,
    secondName: e.second_name,
    webName: e.web_name,
    position: pos,
    teamFplId: e.team,
    nowCost: e.now_cost, // already tenths
    status: e.status,
    // null means fully fit — preserved as null, never coerced to 0 (which would bench every fit player).
    chanceOfPlayingNextRound: e.chance_of_playing_next_round,
    news: e.news === '' ? null : e.news,
    newsAddedAt: e.news_added ? new Date(e.news_added) : null,
    form: e.form,
    pointsPerGame: e.points_per_game,
    epNext: e.ep_next,
    epThis: e.ep_this,
    expectedGoalsPer90: e.expected_goals_per_90,
    expectedAssistsPer90: e.expected_assists_per_90,
    expectedGoalsConcededPer90: e.expected_goals_conceded_per_90,
    defensiveContributionPer90: e.defensive_contribution_per_90,
    savesPer90: e.saves_per_90,
    startsPer90: e.starts_per_90,
    penaltiesOrder: e.penalties_order,
    directFreekicksOrder: e.direct_freekicks_order,
    cornersOrder: e.corners_and_indirect_freekicks_order,
    seasonMinutes: e.minutes,
    seasonStarts: e.starts,
  };
}

/** A prior season's totals from `history_past`. The player id comes from the fetch context. */
export function mapSeasonHistory(h: RawSeasonHistory): MappedSeasonHistory {
  return {
    season: h.season_name,
    totalPoints: h.total_points,
    minutes: h.minutes,
    starts: h.starts,
    goalsScored: h.goals_scored,
    assists: h.assists,
    cleanSheets: h.clean_sheets,
    goalsConceded: h.goals_conceded,
    saves: h.saves,
    bonus: h.bonus,
    bps: h.bps,
    defensiveContribution: h.defensive_contribution ?? 0,
    expectedGoals: h.expected_goals,
    expectedAssists: h.expected_assists,
    expectedGoalsConceded: h.expected_goals_conceded,
    startCost: h.start_cost,
    endCost: h.end_cost,
  };
}

export function mapGameweek(ev: RawEvent): MappedGameweek {
  return {
    id: ev.id,
    name: ev.name,
    deadlineTime: new Date(ev.deadline_time),
    finished: ev.finished,
    dataChecked: ev.data_checked,
    isCurrent: ev.is_current,
    isNext: ev.is_next,
    averageScore: ev.average_entry_score,
    highestScore: ev.highest_score,
  };
}

export function mapFixture(f: RawFixture): MappedFixture {
  return {
    fplId: f.id,
    gameweekId: f.event, // nullable — unassigned fixtures are normal
    kickoffTime: f.kickoff_time ? new Date(f.kickoff_time) : null,
    homeTeamFplId: f.team_h,
    awayTeamFplId: f.team_a,
    homeScore: f.team_h_score,
    awayScore: f.team_a_score,
    homeDifficulty: f.team_h_difficulty,
    awayDifficulty: f.team_a_difficulty,
    started: f.started ?? false,
    finished: f.finished,
  };
}

export function mapOwnership(e: RawElement): MappedOwnership {
  return {
    playerFplId: e.id,
    selectedByPercent: e.selected_by_percent, // decimal string, kept exact
    transfersInEvent: e.transfers_in_event,
    transfersOutEvent: e.transfers_out_event,
  };
}

export function mapGameweekStat(h: RawElementHistory): MappedGameweekStat {
  return {
    playerFplId: h.element,
    gameweekId: h.round,
    fixtureFplId: h.fixture,
    wasHome: h.was_home,
    opponentTeamFplId: h.opponent_team,
    minutes: h.minutes,
    starts: h.starts,
    totalPoints: h.total_points,
    goalsScored: h.goals_scored,
    assists: h.assists,
    cleanSheets: h.clean_sheets,
    goalsConceded: h.goals_conceded,
    ownGoals: h.own_goals,
    penaltiesSaved: h.penalties_saved,
    penaltiesMissed: h.penalties_missed,
    yellowCards: h.yellow_cards,
    redCards: h.red_cards,
    saves: h.saves,
    bonus: h.bonus,
    bps: h.bps,
    defensiveContribution: h.defensive_contribution ?? 0,
    expectedGoals: h.expected_goals,
    expectedAssists: h.expected_assists,
    expectedGoalsConceded: h.expected_goals_conceded,
    ictIndex: h.ict_index,
    value: h.value, // tenths, price at that gameweek
    selectedBy: h.selected ?? 0,
  };
}

/** A season label like "2026/27", derived from the earliest event deadline. */
export function seasonLabel(events: RawEvent[]): string {
  const years = events.map((e) => new Date(e.deadline_time).getUTCFullYear());
  const start = Math.min(...years);
  const end = (start + 1) % 100;
  return `${start}/${end.toString().padStart(2, '0')}`;
}
