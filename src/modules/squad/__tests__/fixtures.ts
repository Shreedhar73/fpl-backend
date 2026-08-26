import type { RawEntry, RawEntryPicks } from '../../../infra/fpl/fpl.types';

/**
 * Recorded from the live API on 2026-08-26 — `entry/1/` and `entry/1/event/1/picks/`, trimmed to
 * the fields the importer reads. Recorded rather than invented so the test fails if upstream's
 * shape moves; the fields absent here are absent upstream too, which is the point of the file.
 *
 * Note what a pick does NOT carry: no `purchase_price`, no `selling_price`.
 */
export const ENTRY_1: RawEntry = {
  id: 1,
  player_first_name: 'Chris',
  player_last_name: 'Musson',
  started_event: 1,
  current_event: 1,
  summary_overall_points: 41,
  summary_overall_rank: 6875541,
};

export const PICKS_1: RawEntryPicks = {
  active_chip: null,
  automatic_subs: [],
  entry_history: {
    event: 1,
    points: 41,
    total_points: 41,
    bank: 0,
    value: 1000,
    event_transfers: 0,
    event_transfers_cost: 0,
    points_on_bench: 4,
  },
  picks: [
    {
      element: 1,
      position: 1,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 1,
    },
    {
      element: 4,
      position: 2,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 2,
    },
    {
      element: 418,
      position: 3,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 2,
    },
    {
      element: 532,
      position: 4,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 2,
    },
    {
      element: 557,
      position: 5,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 3,
    },
    {
      element: 426,
      position: 6,
      multiplier: 2,
      is_captain: true,
      is_vice_captain: false,
      element_type: 3,
    },
    {
      element: 397,
      position: 7,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 3,
    },
    {
      element: 542,
      position: 8,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 3,
    },
    {
      element: 427,
      position: 9,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: true,
      element_type: 3,
    },
    {
      element: 351,
      position: 10,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 4,
    },
    {
      element: 470,
      position: 11,
      multiplier: 1,
      is_captain: false,
      is_vice_captain: false,
      element_type: 4,
    },
    {
      element: 200,
      position: 12,
      multiplier: 0,
      is_captain: false,
      is_vice_captain: false,
      element_type: 1,
    },
    {
      element: 311,
      position: 13,
      multiplier: 0,
      is_captain: false,
      is_vice_captain: false,
      element_type: 2,
    },
    {
      element: 88,
      position: 14,
      multiplier: 0,
      is_captain: false,
      is_vice_captain: false,
      element_type: 3,
    },
    {
      element: 99,
      position: 15,
      multiplier: 0,
      is_captain: false,
      is_vice_captain: false,
      element_type: 4,
    },
  ],
};

export const PLAYER_ROWS = PICKS_1.picks.map((p, i) => ({
  id: `player_${p.element}`,
  fplId: p.element,
  webName: `Player${p.element}`,
  position: (['GKP', 'DEF', 'MID', 'FWD'] as const)[p.element_type - 1],
  nowCost: 50 + i,
  teamShortName: 'ARS',
}));
