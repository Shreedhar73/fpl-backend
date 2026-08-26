/**
 * The subset of the official FPL API payloads that the sync reads. Field names and nullability
 * are taken from live responses (see the `fpl-api-reference` skill), not from memory. Only the
 * fields we actually persist are typed here; the upstream objects carry many more.
 *
 * Gotchas encoded in the types: money is an integer in tenths; `chance_of_playing_next_round` is
 * `null` when a player is fully fit; `event` and `kickoff_time` on a fixture are nullable; every
 * `expected_*` / ICT field and `selected_by_percent` arrives as a decimal STRING, never a number.
 */

export interface RawTeam {
  id: number;
  code: number;
  name: string;
  short_name: string;
  strength: number | null;
  strength_overall_home: number;
  strength_overall_away: number;
  strength_attack_home: number;
  strength_attack_away: number;
  strength_defence_home: number;
  strength_defence_away: number;
}

export interface RawElementType {
  id: number;
  singular_name_short: string; // 'GKP' | 'DEF' | 'MID' | 'FWD'
  squad_select: number; // how many to pick in the 15
  squad_min_play: number; // min in the XI
  squad_max_play: number; // max in the XI
}

export interface RawElement {
  id: number;
  code: number;
  first_name: string;
  second_name: string;
  web_name: string;
  element_type: number;
  team: number;
  team_code: number;
  now_cost: number; // tenths
  status: string; // a d i s u n
  chance_of_playing_next_round: number | null; // null == fully fit
  news: string;
  news_added: string | null;
  selected_by_percent: string; // decimal string
  transfers_in_event: number;
  transfers_out_event: number;

  // Projection inputs. ep_*/form/points_per_game are decimal STRINGS; the per_90 family are numbers.
  form: string | null;
  points_per_game: string | null;
  ep_next: string | null;
  ep_this: string | null;
  expected_goals_per_90: number;
  expected_assists_per_90: number;
  expected_goals_conceded_per_90: number;
  defensive_contribution_per_90: number;
  saves_per_90: number;
  starts_per_90: number;
  penalties_order: number | null;
  direct_freekicks_order: number | null;
  corners_and_indirect_freekicks_order: number | null;
  minutes: number; // season total
  starts: number; // season total
}

/** One row of `element-summary/{id}/`'s `history_past` array — a prior SEASON's totals. */
export interface RawSeasonHistory {
  season_name: string;
  element_code: number;
  total_points: number;
  minutes: number;
  starts: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution?: number;
  expected_goals: string;
  expected_assists: string;
  expected_goals_conceded: string;
  start_cost: number;
  end_cost: number;
}

export interface RawEvent {
  id: number;
  name: string;
  deadline_time: string;
  finished: boolean;
  data_checked: boolean;
  is_current: boolean;
  is_next: boolean;
  average_entry_score: number | null;
  highest_score: number | null;
}

export interface RawGameConfig {
  scoring: unknown;
  rules: unknown;
}

export interface Bootstrap {
  teams: RawTeam[];
  element_types: RawElementType[];
  elements: RawElement[];
  events: RawEvent[];
  game_config: RawGameConfig;
}

export interface RawFixture {
  id: number;
  event: number | null; // null == not yet assigned to a gameweek
  kickoff_time: string | null; // null == not yet scheduled
  team_h: number;
  team_a: number;
  team_h_score: number | null;
  team_a_score: number | null;
  team_h_difficulty: number;
  team_a_difficulty: number;
  started: boolean | null;
  finished: boolean;
}

/** One row of `element-summary/{id}/`'s `history` array. */
export interface RawElementHistory {
  element: number;
  fixture: number;
  round: number; // gameweek
  was_home: boolean;
  opponent_team: number; // fpl team id
  minutes: number;
  starts: number;
  total_points: number;
  goals_scored: number;
  assists: number;
  clean_sheets: number;
  goals_conceded: number;
  own_goals: number;
  penalties_saved: number;
  penalties_missed: number;
  yellow_cards: number;
  red_cards: number;
  saves: number;
  bonus: number;
  bps: number;
  defensive_contribution?: number;
  expected_goals: string;
  expected_assists: string;
  expected_goals_conceded: string;
  ict_index: string;
  value: number; // tenths, price at that gameweek
  selected: number;
}

export interface ElementSummary {
  history: RawElementHistory[];
  history_past: RawSeasonHistory[];
}

// --- entry/{manager_id}/ — the public import surface (decision D-013). Read-only, no credential.
//     Field lists verified against the live API on 2026-08-26; see the fpl-api-reference skill.

export interface RawEntry {
  id: number;
  player_first_name: string;
  player_last_name: string;
  name?: string;
  started_event: number;
  /** The gameweek this manager is currently on. Null before their first one. */
  current_event: number | null;
  summary_overall_points: number | null;
  summary_overall_rank: number | null;
  /** tenths of a million */
  last_deadline_bank?: number | null;
  /** tenths of a million */
  last_deadline_value?: number | null;
}

export interface RawEntryPick {
  /** the player's FPL element id */
  element: number;
  /** 1–11 starting XI, 12–15 bench in substitution order */
  position: number;
  multiplier: number;
  is_captain: boolean;
  is_vice_captain: boolean;
  element_type: number;
}

export interface RawEntryHistoryEvent {
  event: number;
  points: number;
  total_points: number;
  /** tenths of a million */
  bank: number;
  /** tenths of a million — squad value excluding the bank */
  value: number;
  event_transfers: number;
  event_transfers_cost: number;
  points_on_bench: number;
}

/**
 * NOTE what is NOT here: `purchase_price` and `selling_price`. Neither exists on any public
 * endpoint — both live in `my-team/{id}/`, which is 403 without authentication, and we never
 * authenticate (D-013). That is why an imported SquadPick carries a null sellValue.
 */
export interface RawEntryPicks {
  active_chip: string | null;
  automatic_subs: unknown[];
  entry_history: RawEntryHistoryEvent;
  picks: RawEntryPick[];
}
