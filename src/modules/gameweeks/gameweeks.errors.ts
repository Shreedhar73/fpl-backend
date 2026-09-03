import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/error-codes';

export class GameweeksError extends HttpException {
  constructor(errorCode: ErrorCode, message: string, status: HttpStatus) {
    super({ errorCode, message }, status);
  }

  static noUpcoming(): GameweeksError {
    return new GameweeksError(
      ErrorCode.NO_UPCOMING_GAMEWEEK,
      'No gameweek has a deadline still to come.',
      HttpStatus.NOT_FOUND,
    );
  }
}
