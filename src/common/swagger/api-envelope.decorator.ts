import { applyDecorators, Type } from '@nestjs/common';
import { ApiExtraModels, ApiResponse, getSchemaPath } from '@nestjs/swagger';
import { ApiEnvelopeDto } from '../dto/api-response.dto';

/**
 * Every response leaves through ResponseEnvelopeInterceptor, so a controller returns plain data
 * and the wire shape is `ApiResponse<T>`. Swagger only sees the return type, which means an
 * undecorated endpoint documents the *unwrapped* payload — and the frontend's generated types
 * would then describe a shape that never arrives.
 *
 * These decorators are the join. Use one on every endpoint; the document then matches the wire,
 * and `types.gen.ts` describes what the client actually has to unwrap.
 */

type DataSchema =
  | { type: Type<unknown>; isArray?: boolean }
  | { schema: Record<string, unknown> };

function envelope(data: DataSchema, extra: Record<string, unknown>) {
  const dataSchema =
    'type' in data
      ? data.isArray
        ? { type: 'array', items: { $ref: getSchemaPath(data.type) } }
        : { $ref: getSchemaPath(data.type) }
      : data.schema;

  return {
    allOf: [
      { $ref: getSchemaPath(ApiEnvelopeDto) },
      { properties: { data: dataSchema, ...extra }, required: ['data'] },
    ],
  };
}

/** A success response whose `data` is `dto` (or an array of it). */
export function ApiEnvelopeResponse(
  dto: Type<unknown>,
  options: { status?: number; isArray?: boolean; description?: string } = {},
) {
  const { status = 200, isArray = false, description } = options;
  return applyDecorators(
    ApiExtraModels(ApiEnvelopeDto, dto),
    ApiResponse({
      status,
      description,
      schema: envelope(
        { type: dto, isArray },
        {
          success: { type: 'boolean', enum: [true] },
          errorCode: { type: 'string', nullable: true, enum: [null] },
        },
      ),
    }),
  );
}

/**
 * A failure response. `errorCode` is pinned to the exact key the service raises, so the frontend
 * can switch on it from the generated types rather than matching on message text.
 */
export function ApiEnvelopeError(
  status: number,
  errorCode: string,
  description: string,
) {
  return applyDecorators(
    ApiExtraModels(ApiEnvelopeDto),
    ApiResponse({
      status,
      description,
      schema: envelope(
        { schema: { type: 'null', nullable: true } },
        {
          success: { type: 'boolean', enum: [false] },
          errorCode: { type: 'string', enum: [errorCode] },
        },
      ),
    }),
  );
}
