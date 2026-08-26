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
}

export interface RawElementType {
  id: number;
  singular_name_short: string; // 'GKP' | 'DEF' | 'MID' | 'FWD'
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
}
