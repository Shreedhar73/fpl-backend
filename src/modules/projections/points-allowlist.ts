/**
 * Players whose points our engine is knowingly unable to reproduce, and why.
 *
 * The bar in `docs/plans/007` is exact reproduction for EVERY player in a checked gameweek. An
 * entry here is a hole in that bar held open deliberately, so each one carries a written reason and
 * the upstream behaviour that causes it — never "flaky" and never a bare id. Anything not listed
 * that mismatches turns the suite red.
 *
 * **The empty list is the goal, and it is currently empty**: all 610 players in GW1 2026/27 reproduce
 * exactly. Adding an entry is a decision to be argued in a PR, not a way to get a build green.
 */
export interface AllowedMismatch {
  /** `elements[].id` in `event/{gw}/live/`, i.e. `Player.fplId`. */
  fplId: number;
  /** The gameweek the exception applies to. An exception is never open-ended. */
  event: number;
  /** What upstream does that we do not reproduce. */
  reason: string;
  /** Where that behaviour is documented or was observed — an issue, a decision, a payload. */
  cause: string;
}

export const ALLOWED_MISMATCHES: AllowedMismatch[] = [];

export function isAllowed(fplId: number, event: number): boolean {
  return ALLOWED_MISMATCHES.some((a) => a.fplId === fplId && a.event === event);
}
