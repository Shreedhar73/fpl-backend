import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode } from '../../common/error-codes';

/**
 * The one way a player lookup fails, as the contract's stable `errorCode`. Same code as the squad
 * module's `unknownPlayerIds` — one id, one row missing, one meaning — but 404 rather than 409,
 * because here the id IS the resource rather than a member of a submitted squad.
 */
export class PlayersError extends HttpException {
  constructor(errorCode: ErrorCode, message: string, status: HttpStatus) {
    super({ errorCode, message }, status);
  }

  static unknownPlayer(playerId: string): PlayersError {
    return new PlayersError(
      ErrorCode.UNKNOWN_PLAYER,
      `No player with id ${playerId}.`,
      HttpStatus.NOT_FOUND,
    );
  }
}
