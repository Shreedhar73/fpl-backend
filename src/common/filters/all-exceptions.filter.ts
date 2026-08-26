import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import type { Response } from 'express';
import type { ApiResponse } from '../dto/api-response.dto';

/** Every error leaves through the same envelope. The frontend never sees a bare Nest error. */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const res = host.switchToHttp().getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;

    let message = 'Internal server error';
    let errorCode = 'INTERNAL_ERROR';

    if (exception instanceof HttpException) {
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        const b = body as { message?: string | string[]; errorCode?: string };
        message = Array.isArray(b.message)
          ? b.message.join('; ')
          : (b.message ?? message);
        errorCode = b.errorCode ?? HttpStatus[status] ?? errorCode;
      }
    } else {
      this.logger.error(exception);
    }

    const payload: ApiResponse<null> = {
      success: false,
      statusCode: status,
      message,
      errorCode,
      data: null,
      meta: null,
    };
    res.status(status).json(payload);
  }
}
