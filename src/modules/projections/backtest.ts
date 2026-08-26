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

export function withinTimeCut(row: TimeCutRow, targetGameweek: number): boolean {
  return row.gameweekId < targetGameweek && row.dataChecked;
}

export function timeCut<T extends TimeCutRow>(rows: T[], targetGameweek: number): T[] {
  return rows.filter((r) => withinTimeCut(r, targetGameweek));
}
