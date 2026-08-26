import { ApiProperty } from '@nestjs/swagger';

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

/**
 * The classes below exist only so the envelope appears in the OpenAPI document, and through it in
 * the frontend's generated types. The interfaces above stay the ones the runtime code is typed
 * against — a class is what `@nestjs/swagger` can emit a schema for, an interface is not.
 *
 * They are kept in the same file as the interfaces deliberately: two declarations of one shape
 * drift the moment they live apart, and the drift would surface as a frontend `undefined`.
 */
export class ApiResponseMetaDto implements ApiResponseMeta {
  @ApiProperty({
    description: 'Echoed from x-request-id, or generated per request.',
  })
  requestId!: string;

  @ApiProperty({ description: 'Server-side handling time in milliseconds.' })
  durationMs!: number;

  @ApiProperty({ format: 'date-time' })
  generatedAt!: string;

  @ApiProperty({
    required: false,
    description:
      "Which gameweek's data produced this. Present on every response carrying model output.",
  })
  dataAsOfGw?: number;
}

export class ApiEnvelopeDto {
  @ApiProperty()
  success!: boolean;

  @ApiProperty()
  statusCode!: number;

  @ApiProperty()
  message!: string;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Stable machine-readable key on failure, e.g. MANAGER_NOT_FOUND. Null when success is true.',
  })
  errorCode!: string | null;

  @ApiProperty({ type: ApiResponseMetaDto, nullable: true })
  meta!: ApiResponseMetaDto | null;
}
