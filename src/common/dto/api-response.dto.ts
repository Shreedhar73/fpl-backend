/**
 * The single response shape every endpoint returns. Applied by ResponseEnvelopeInterceptor —
 * controllers return plain data and never build this themselves.
 *
 * `meta.dataAsOfGw` is not decoration: this app serves derived numbers, and the worst failure
 * mode is a stale projection rendered as if it were live. Any response carrying model output
 * states which gameweek's data produced it.
 */
export interface ApiResponseMeta {
  requestId: string;
  durationMs: number;
  generatedAt: string;
  dataAsOfGw?: number;
}

export interface ApiResponse<T> {
  success: boolean;
  statusCode: number;
  message: string;
  errorCode: string | null;
  data: T;
  meta: ApiResponseMeta | null;
}
