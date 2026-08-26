/**
 * Team attack/defence strength from rolling expected goals, turned into a per-fixture *effective
 * difficulty* that replaces the raw FDR digit — but only as far as the data supports it.
 *
 * The honest constraint (measured 2026-08-26): early season there is ~one match of xG per team, FPL's
 * own granular attack/defence ratings read 0 (uncalibrated), and past-season TEAM xG is not
 * reconstructable because players change clubs. So this blends the xG-derived difficulty with FDR by a
 * confidence that grows with matches played: at one match it is ~80% FDR (and FDR early season is
 * itself set from last season's table, so "past years" are already in there); by mid-season the xG
 * signal dominates. FDR conflates attacking and defensive difficulty into one number; the xG model
 * splits them — scoring is about the opponent's defence, clean sheets about the opponent's attack.
 */
export interface TeamRating {
  fplId: number;
  matches: number;
  xgForPerMatch: number; // attacking output
  xgAgainstPerMatch: number; // defensive leakiness
}

export interface EffectiveDifficulty {
  attackDifficulty: number; // for the goals/assists terms
  defenceDifficulty: number; // for the clean-sheet / goals-conceded terms
}

/** matches-worth of data before the xG signal is trusted over FDR. */
const CONFIDENCE_MATCHES = 4;
/** xG-per-match distance from the league average that moves difficulty by one step. */
const SPREAD = 0.6;

export function leagueAverageXg(ratings: Iterable<TeamRating>): number {
  const withData = [...ratings].filter((r) => r.matches > 0);
  if (withData.length === 0) return 0;
  return withData.reduce((s, r) => s + r.xgForPerMatch, 0) / withData.length;
}

export function effectiveDifficulty(
  fdr: number,
  opponent: TeamRating | undefined,
  leagueAvgXg: number,
): EffectiveDifficulty {
  if (!opponent || opponent.matches === 0 || leagueAvgXg <= 0) {
    return { attackDifficulty: fdr, defenceDifficulty: fdr };
  }
  // Opponent concedes more than average → easier to score → LOWER attacking difficulty.
  const attackXg = clampDifficulty(3 - (opponent.xgAgainstPerMatch - leagueAvgXg) / SPREAD);
  // Opponent creates more than average → harder to keep a clean sheet → HIGHER defensive difficulty.
  const defenceXg = clampDifficulty(3 + (opponent.xgForPerMatch - leagueAvgXg) / SPREAD);

  const conf = opponent.matches / (opponent.matches + CONFIDENCE_MATCHES);
  return {
    attackDifficulty: conf * attackXg + (1 - conf) * fdr,
    defenceDifficulty: conf * defenceXg + (1 - conf) * fdr,
  };
}

function clampDifficulty(x: number): number {
  return Math.max(1, Math.min(5, x));
}
