/**
 * The stable `errorCode` keys the envelope carries. They live in `src/common/` because they are
 * part of the HTTP contract rather than any one module's internals: `insights` documents
 * SQUAD_NOT_IMPORTED on its own routes, and the frontend switches on all of them.
 *
 * Adding one is a contract change — it reaches the frontend through the OpenAPI document, so the
 * name is as public as the endpoint.
 */
export const ErrorCode = {
  /** No FPL manager with that id — the user's mistake, and actionable. */
  MANAGER_NOT_FOUND: 'MANAGER_NOT_FOUND',
  /** The manager exists; their picks are not public yet. Never conflated with the above. */
  SQUAD_NOT_AVAILABLE_YET: 'SQUAD_NOT_AVAILABLE_YET',
  /** Upstream timed out or failed. Ours to report, never passed through as their status. */
  FPL_UPSTREAM_UNAVAILABLE: 'FPL_UPSTREAM_UNAVAILABLE',
  /** A player id, ours or FPL's, with no row behind it. */
  UNKNOWN_PLAYER: 'UNKNOWN_PLAYER',
  /** Asked for a squad we have never fetched. */
  SQUAD_NOT_IMPORTED: 'SQUAD_NOT_IMPORTED',
  /** A hand-built squad that breaks at least one rule. */
  SQUAD_ILLEGAL: 'SQUAD_ILLEGAL',
  /** Every gameweek's deadline has passed — the season is over, or the sync has not run. */
  NO_UPCOMING_GAMEWEEK: 'NO_UPCOMING_GAMEWEEK',
} as const;

export type ErrorCode = (typeof ErrorCode)[keyof typeof ErrorCode];
