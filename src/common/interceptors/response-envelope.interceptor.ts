import {
  CallHandler,
  ExecutionContext,
  Injectable,
  NestInterceptor,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Observable } from 'rxjs';
import { map } from 'rxjs/operators';
import type { ApiResponse } from '../dto/api-response.dto';

@Injectable()
export class ResponseEnvelopeInterceptor<T>
  implements NestInterceptor<T, ApiResponse<T>>
{
  intercept(ctx: ExecutionContext, next: CallHandler<T>): Observable<ApiResponse<T>> {
    const started = Date.now();
    const http = ctx.switchToHttp();
    const requestId =
      (http.getRequest<{ headers: Record<string, string> }>().headers['x-request-id'] as string) ??
      randomUUID();

    return next.handle().pipe(
      map((data) => ({
        success: true,
        statusCode: http.getResponse<{ statusCode: number }>().statusCode,
        message: 'OK',
        errorCode: null,
        data,
        meta: {
          requestId,
          durationMs: Date.now() - started,
          generatedAt: new Date().toISOString(),
        },
      })),
    );
  }
}
