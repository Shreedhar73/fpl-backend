/**
 * Stamp the gameweek a response's numbers were computed from. ResponseEnvelopeInterceptor reads it
 * back and puts it in `meta.dataAsOfGw`.
 *
 * Not decoration: this app serves derived numbers, and the worst failure it has is a stale
 * projection rendered as if it were live. Every response carrying model output calls this
 * (fpl-architecture-contract §3).
 */
export interface DataAsOfRequest {
  dataAsOfGw?: number;
}

export function markDataAsOf(req: DataAsOfRequest, gameweekId: number): void {
  req.dataAsOfGw = gameweekId;
}
