/**
 * The time-cut that keeps a backtest honest (`fpl-testing-contract`). Predicting gameweek *k* may
 * read only gameweeks **strictly before k**, and only rows whose gameweek is `data_checked` — because
 * `finished` flips before bonus and stat corrections land, so a `finished`-but-unchecked row carries
 * numbers that did not exist at decision time. Reading either is the leak that makes a broken model
 * look excellent.
 *
 * This is the pure filter the (DB-backed) backtest will run its inputs through; it is unit-tested by
 * inverting it — a row from gameweek ≥ k, or an unchecked one, must be excluded.
 */
export interface TimeCutRow {
  gameweekId: number;
  dataChecked: boolean;
}

export function withinTimeCut(
  row: TimeCutRow,
  targetGameweek: number,
): boolean {
  return row.gameweekId < targetGameweek && row.dataChecked;
}

export function timeCut<T extends TimeCutRow>(
  rows: T[],
  targetGameweek: number,
): T[] {
  return rows.filter((r) => withinTimeCut(r, targetGameweek));
}

/**
 * The SAME cut across seasons, which is what a multi-season backtest needs (B-007 Phase 3).
 *
 * Predicting round *k* of season *s* may read every row of an EARLIER season, and only rounds < k of
 * season *s* itself. The single-season filter above cannot express that: applied across seasons it
 * either drops every prior season (round numbers repeat) or admits the rest of the current one.
 *
 * The second half is the trap worth naming. An aggregate computed over a whole season and applied to
 * that season's own early gameweeks — team strength, a player's rate, a shrinkage prior — is a leak of
 * exactly the kind this file exists to stop, one level up. Nothing looks wrong when it happens; the
 * model simply appears to be good.
 *
 * Archive rows carry no `dataChecked` flag and need none: their seasons are over, so every correction
 * has landed. That is a property of the archive and NOT of the live season, which is why the live path
 * above keeps the flag.
 */
export interface SeasonRound {
  season: string;
  round: number;
}

/** Season labels sort lexicographically, so "2023-24" < "2024-25" < "2025-26" needs no parsing. */
export function withinSeasonRoundCut(
  row: SeasonRound,
  target: SeasonRound,
): boolean {
  if (row.season !== target.season) return row.season < target.season;
  return row.round < target.round;
}

export function seasonRoundCut<T extends SeasonRound>(
  rows: T[],
  target: SeasonRound,
): T[] {
  return rows.filter((r) => withinSeasonRoundCut(r, target));
}
