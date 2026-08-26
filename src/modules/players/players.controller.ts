import { Controller, Get, Req } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiEnvelopeResponse } from '../../common/swagger/api-envelope.decorator';
import { markDataAsOf, type DataAsOfRequest } from '../../common/data-as-of';
import { PlayerListDto } from './dto/player.dto';
import { PlayersService } from './players.service';

@ApiTags('players')
@Controller('players')
export class PlayersController {
  constructor(private readonly players: PlayersService) {}

  @Get()
  @ApiOperation({
    summary: 'Every player in the game, with our expected points where we have them.',
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
}
