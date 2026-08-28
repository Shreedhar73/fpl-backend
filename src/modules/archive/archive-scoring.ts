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
 * Before 2025-26 there was no defensive-contribution category at all.
 *
 * Entering these two seasons is not optional depth — it is a correctness fix found while fitting.
 * Scoring 2023-24 and 2024-25 with the current table gives every player a defensive-contribution
 * term in seasons where no such points existed, so the model learns to predict points that could not
 * be scored and the fit responds by shrinking the term toward zero for every season including the one
 * where it is real. The category is priced at 0 here, which is what "did not exist" means in a table
 * whose shape is fixed.
 */
const SCORING_PRE_DEFCON: RawScoring = {
  ...SCORING_2025_26,
  defensive_contribution: { GKP: 0, DEF: 0, MID: 0, FWD: 0 },
};

/**
 * Before 2025-26 a goalkeeper's goal was worth SIX, not ten, and there is exactly one row in the
 * archive that proves it: a keeper scored in 2020-21. Re-scoring every season from 2016-17 to
 * 2022-23 with a ten-point keeper goal produces that single mismatch and no other; with six it
 * produces none.
 *
 * That one row is also why the 2023-24 and 2024-25 tables above can carry GKP: 10 and still verify
 * with zero mismatches — no keeper scored in either season, so those seasons say nothing about the
 * value, exactly as the 2025-26 comment warns. The older tables are constrained by evidence the
 * newer ones are not.
 */
const SCORING_PRE_2025_26: RawScoring = {
  ...SCORING_PRE_DEFCON,
  goals_scored: { GKP: 6, DEF: 6, MID: 5, FWD: 4 },
};

const OLDER_SEASONS = [
  '2016-17',
  '2017-18',
  '2018-19',
  '2019-20',
  '2020-21',
  '2021-22',
  '2022-23',
] as const;

export const ARCHIVE_SCORING: ArchiveScoringTable[] = [
  ...OLDER_SEASONS.map((season) => ({
    season,
    scoring: SCORING_PRE_2025_26,
    source:
      'the 2025-26 table with defensive contribution priced at 0 and a goalkeeper goal at 6; the ' +
      'keeper value is pinned by the single keeper goal in 2020-21, which mismatches at 10 and ' +
      'matches at 6, and the whole table is proved by re-scoring every row of every season ' +
      '(2026-08-28)',
  })),
  {
    season: '2023-24',
    scoring: SCORING_PRE_DEFCON,
    source:
      'the 2025-26 table with the defensive-contribution category priced at 0, since it did not ' +
      'exist before 2025-26; proved by re-scoring the season with zero mismatches (2026-08-26)',
  },
  {
    season: '2024-25',
    scoring: SCORING_PRE_DEFCON,
    source:
      'the 2025-26 table with the defensive-contribution category priced at 0, since it did not ' +
      'exist before 2025-26; proved by re-scoring the season with zero mismatches (2026-08-26)',
  },
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
