import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
} from '../../common/swagger/api-envelope.decorator';
import { ErrorCode } from '../../common/error-codes';
import { NextGameweekDto } from './dto/next-gameweek.dto';
import { GameweeksService } from './gameweeks.service';

@ApiTags('gameweeks')
@Controller('gameweeks')
export class GameweeksController {
  constructor(private readonly gameweeks: GameweeksService) {}

  @Get('next')
  @ApiOperation({
    summary:
      'The gameweek a decision can still be made for, with its deadline and the horizon.',
    description:
      'Calendar only, no model output — so no `dataAsOfGw`. The first gameweek whose deadline ' +
      'has not passed, and the gameweek ids the advice is solved over from there.',
  })
  @ApiEnvelopeResponse(NextGameweekDto, { description: 'The next gameweek.' })
  @ApiEnvelopeError(
    404,
    ErrorCode.NO_UPCOMING_GAMEWEEK,
    'Every deadline has passed, or the calendar has not been synced.',
  )
  next(): Promise<NextGameweekDto> {
    return this.gameweeks.next();
  }
}
