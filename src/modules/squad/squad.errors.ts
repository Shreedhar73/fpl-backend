import { HttpException, HttpStatus } from '@nestjs/common';

/**
 * Every way an import can fail, as a stable `errorCode` the frontend switches on. The exception
 * filter reads `errorCode` off the response body, so throwing one of these is all it takes to get
 * it into the envelope.
 *
 * The distinction that matters: `MANAGER_NOT_FOUND` is the user's mistake and is actionable;
 * `FPL_UPSTREAM_UNAVAILABLE` is upstream's and is not. Collapsing the two would tell someone their
 * manager id is wrong when in fact FPL is down — the single most annoying thing this endpoint
 * could do.
 */
export const SquadErrorCode = {
  MANAGER_NOT_FOUND: 'MANAGER_NOT_FOUND',
  SQUAD_NOT_AVAILABLE_YET: 'SQUAD_NOT_AVAILABLE_YET',
  FPL_UPSTREAM_UNAVAILABLE: 'FPL_UPSTREAM_UNAVAILABLE',
  UNKNOWN_PLAYER: 'UNKNOWN_PLAYER',
  SQUAD_NOT_IMPORTED: 'SQUAD_NOT_IMPORTED',
} as const;

export type SquadErrorCode =
  (typeof SquadErrorCode)[keyof typeof SquadErrorCode];

export class SquadError extends HttpException {
  constructor(errorCode: SquadErrorCode, message: string, status: HttpStatus) {
    super({ errorCode, message }, status);
  }

  static managerNotFound(managerId: number): SquadError {
    return new SquadError(
      SquadErrorCode.MANAGER_NOT_FOUND,
      `No FPL manager with id ${managerId}. It is the number in the /entry/<id>/ URL on the official site.`,
      HttpStatus.NOT_FOUND,
    );
  }

  static squadNotAvailableYet(managerId: number, reason: string): SquadError {
    return new SquadError(
      SquadErrorCode.SQUAD_NOT_AVAILABLE_YET,
      `Manager ${managerId} has no readable squad yet: ${reason}. Picks become public after a gameweek's deadline.`,
      HttpStatus.CONFLICT,
    );
  }

  static upstreamUnavailable(detail: string): SquadError {
    return new SquadError(
      SquadErrorCode.FPL_UPSTREAM_UNAVAILABLE,
      `The official FPL API did not answer (${detail}). Nothing is wrong with your manager id — try again shortly.`,
      HttpStatus.BAD_GATEWAY,
    );
  }

  static unknownPlayer(fplIds: number[]): SquadError {
    return new SquadError(
      SquadErrorCode.UNKNOWN_PLAYER,
      `This squad contains ${fplIds.length} player(s) this app has never synced (FPL element ${fplIds.join(', ')}). Run the FPL sync and try again.`,
      HttpStatus.CONFLICT,
    );
  }

  static notImported(managerId: number): SquadError {
    return new SquadError(
      SquadErrorCode.SQUAD_NOT_IMPORTED,
      `Manager ${managerId} has not been imported. POST /api/squad/import first.`,
      HttpStatus.NOT_FOUND,
    );
  }
}
