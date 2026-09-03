import { Controller, Get, Param, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
} from '../../common/swagger/api-envelope.decorator';
import { markDataAsOf, type DataAsOfRequest } from '../../common/data-as-of';
import { ErrorCode } from '../../common/error-codes';
import { PlayerDetailDto } from './dto/player-detail.dto';
import { PlayerListDto } from './dto/player.dto';
import { PlayersService } from './players.service';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({
    summary:
      'Every player in the game, with our expected points where we have them.',
    description:
      'Served whole rather than paged: the row count is bounded by the game itself, and a picker ' +
      'filters across all of it at once. Expected points are null, not zero, for a player the ' +
      'model has not projected.',
  })
  @ApiEnvelopeResponse(PlayerListDto, { description: 'The player universe.' })
  async list(@Req() req: DataAsOfRequest): Promise<PlayerListDto> {
    const list = await this.players.list();
    // Carries model output when the projections are attached, and says which gameweek they are for.
    if (list.gameweekId !== null) markDataAsOf(req, list.gameweekId);
    return list;
  }

  /**
   * Declared after the bare `@Get()`. The parameter is a cuid rather than a number, so there is no
   * literal route for it to swallow — the order is kept deliberate all the same.
   */
  @Get(':playerId')
  @ApiOperation({
    summary:
      'One player, whole: projections over the horizon, fixtures, form and availability.',
    description:
      'The payload behind the player sheet. Projections are the served model’s, one per horizon ' +
      'gameweek, each with that gameweek’s fixtures and difficulty from the player’s side; ' +
      '`projections` is empty, not zeros, for a player the model has not reached.',
  })
  @ApiParam({
    name: 'playerId',
    type: String,
    description: 'Our internal id (cuid).',
  })
  @ApiEnvelopeResponse(PlayerDetailDto, { description: 'The player.' })
  @ApiEnvelopeError(404, ErrorCode.UNKNOWN_PLAYER, 'No player with that id.')
  async detail(
    @Param('playerId') playerId: string,
    @Req() req: DataAsOfRequest,
  ): Promise<PlayerDetailDto> {
    const detail = await this.players.detail(playerId);
    if (detail.horizonGameweekIds.length > 0)
      markDataAsOf(req, detail.horizonGameweekIds[0]);
    return detail;
  }
}
