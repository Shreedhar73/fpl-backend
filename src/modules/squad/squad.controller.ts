import {
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
  Req,
} from '@nestjs/common';
import { markDataAsOf, type DataAsOfRequest } from '../../common/data-as-of';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
} from '../../common/swagger/api-envelope.decorator';
import { ImportSquadDto } from './dto/import-squad.dto';
import { SquadDto } from './dto/squad.dto';
import { SquadValidationDto, ValidateSquadDto } from './dto/validate-squad.dto';
import { ErrorCode } from '../../common/error-codes';
import { SquadService } from './squad.service';

/**
 * HTTP only — routes, validation, documentation. The rules are in the service.
 *
 * **Route order is load-bearing.** `recommended` is declared before `:managerId`, because Nest
 * matches in declaration order and the parameter route would otherwise swallow the literal and
 * fail in ParseIntPipe with an error about "recommended" not being a number, which names the
 * wrong problem entirely.
 */
@ApiTags('squad')
@Controller('squad')
export class SquadController {
  constructor(private readonly squad: SquadService) {}

  @Post('import')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Import a squad from a public FPL manager id.',
    description:
      "Fetches the manager's last-locked picks from the public API and persists them. No " +
      'credential is involved and none is accepted (D-013): the manager id is an input, not an ' +
      'identity. The pre-deadline unsaved squad is not public and is not returned. This is the ' +
      'one endpoint that calls upstream while you wait, so it carries a short timeout; a second ' +
      'call for the same manager and gameweek is served from GET /api/squad/{managerId}.',
  })
  @ApiEnvelopeResponse(SquadDto, {
    description: 'The imported squad, now persisted.',
  })
  @ApiEnvelopeError(404, ErrorCode.MANAGER_NOT_FOUND, 'No such manager id.')
  @ApiEnvelopeError(
    409,
    ErrorCode.SQUAD_NOT_AVAILABLE_YET,
    'The manager exists but has no readable picks yet — picks become public after a deadline.',
  )
  @ApiEnvelopeError(
    409,
    ErrorCode.UNKNOWN_PLAYER,
    'The squad contains a player this app has not synced.',
  )
  @ApiEnvelopeError(
    502,
    ErrorCode.FPL_UPSTREAM_UNAVAILABLE,
    "The official API timed out or failed. Not the manager id's fault.",
  )
  import(@Body() body: ImportSquadDto): Promise<SquadDto> {
    return this.squad.importSquad(body.managerId);
  }

  @Post('validate')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Check whether a set of players is a legal squad.',
    description:
      'Returns EVERY broken rule, not just the first — a builder that reports one violation at a ' +
      'time makes the user play twenty questions with the form. Prices, positions and clubs are ' +
      'read from our own store, so the numbers cannot be supplied by the caller, and every limit ' +
      'comes from scoring_config rather than a constant.',
  })
  @ApiEnvelopeResponse(SquadValidationDto, {
    description: 'The verdict, with the counts behind it.',
  })
  @ApiEnvelopeError(
    409,
    ErrorCode.UNKNOWN_PLAYER,
    'One of those player ids does not exist.',
  )
  validate(@Body() body: ValidateSquadDto): Promise<SquadValidationDto> {
    return this.squad.validateSquad(body.playerIds);
  }

  @Get('recommended')
  @ApiOperation({
    summary:
      "The optimizer's own best legal 15, in the same shape as an imported squad.",
    description:
      'Solved fresh, and deliberately not persisted to squads — it belongs to no manager, and ' +
      'every solve is already recorded in optimizer_runs.',
  })
  @ApiEnvelopeResponse(SquadDto, {
    description: 'The recommended squad. managerId is null.',
  })
  async recommended(@Req() req: DataAsOfRequest): Promise<SquadDto> {
    const squad = await this.squad.getRecommendedSquad();
    // This one is model output — an optimizer solve — so it states which gameweek's projections
    // produced it. The imported and stored squads below are upstream's own data and do not.
    markDataAsOf(req, squad.gameweekId);
    return squad;
  }

  @Get(':managerId')
  @ApiOperation({
    summary: 'A previously imported squad, from our own store.',
    description: 'Reads Postgres. Makes no upstream call.',
  })
  @ApiParam({ name: 'managerId', type: Number, example: 1 })
  @ApiEnvelopeResponse(SquadDto, { description: 'The stored squad.' })
  @ApiEnvelopeError(
    404,
    ErrorCode.SQUAD_NOT_IMPORTED,
    'This manager has never been imported.',
  )
  get(@Param('managerId', ParseIntPipe) managerId: number): Promise<SquadDto> {
    return this.squad.getSquad(managerId);
  }
}
