import { RawScoring } from '../projections/scoring';

/**
 * Scoring tables for PAST seasons.
 *
 * Upstream serves only the current season's `game_config`, and the archive carries none, so a season's
 * table has to be reconstructed here. That is a hand-entered number in a project whose rule is that
 * points values come from config — so each table is **proved rather than trusted**: the importer
 * re-scores every row of that season with `pointsFor` and refuses the import unless the official
 * `total_points` comes back exactly, for every player in every gameweek.
 *
 * A wrong table cannot survive that. Get `assists` wrong by one and thousands of rows disagree.
 */
export interface ArchiveScoringTable {
  season: string;
  scoring: RawScoring;
  /** what these values were checked against, so a later session can re-check rather than re-trust */
  source: string;
}

/**
 * 2025-26 is byte-identical to the live 2026/27 table — established, not assumed: scoring all 29,747
 * rows of the season with the 2026/27 config produced zero mismatches, which it could not have done
 * if any value a player actually earned had changed between the two seasons.
 *
 * Note what that does and does not prove. It pins every value the season EXERCISED. A value no player
 * triggered in 2025-26 is unconstrained by this evidence.
 */
const SCORING_2025_26: RawScoring = {
  long_play: 2,
  short_play: 1,
  goals_scored: { GKP: 10, DEF: 6, MID: 5, FWD: 4 },
  clean_sheets: { GKP: 4, DEF: 4, MID: 1, FWD: 0 },
  goals_conceded: { GKP: -1, DEF: -1, MID: 0, FWD: 0 },
  defensive_contribution: { GKP: 0, DEF: 2, MID: 2, FWD: 2 },
  assists: 3,
  saves: 1,
  bonus: 1,
  own_goals: -2,
  penalties_saved: 5,
  penalties_missed: -2,
  yellow_cards: -1,
  red_cards: -3,
};

/**
 * Only 2025-26 is entered.
 *
 * 2023-24 and 2024-25 are deliberately absent: they are optional depth for B-007 (the defensive
 * contribution knob — the one the over-projection is blamed on — exists only in 2025-26), and an
 * unentered season is skipped loudly by the importer rather than scored with the wrong table. Adding
 * one means entering its values and letting the same verification reject them if they are wrong.
 */
export const ARCHIVE_SCORING: ArchiveScoringTable[] = [
  {
    season: '2025-26',
    scoring: SCORING_2025_26,
    source:
      'game_config.scoring for 2026/27, confirmed against 2025-26 by re-scoring all 29,747 archive ' +
      'rows with zero mismatches (B-007 Phase 2b, 2026-08-26)',
  },
];

export function scoringForSeason(
  season: string,
): ArchiveScoringTable | undefined {
  return ARCHIVE_SCORING.find((t) => t.season === season);
}
