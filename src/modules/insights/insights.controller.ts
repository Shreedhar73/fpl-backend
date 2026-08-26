import { Controller, Get, Param, ParseIntPipe, Req } from '@nestjs/common';
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
} from '../../common/swagger/api-envelope.decorator';
import { markDataAsOf, type DataAsOfRequest } from '../../common/data-as-of';
import { SquadErrorCode } from '../squad/squad.errors';
import { AdviceDto } from './dto/advice.dto';
import { InsightsService } from './insights.service';

/**
 * Route order is load-bearing here too: `advice/recommended` is declared before
 * `advice/:managerId`, or the parameter route swallows the literal.
 *
 * Both responses carry model output, so both stamp `meta.dataAsOfGw`.
 */
@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(private readonly insights: InsightsService) {}

  @Get('advice/recommended')
  @ApiOperation({
    summary: "Advice for the optimizer's own squad.",
    description:
      'Mostly useful as a check on the comparison: a squad measured against itself must report a ' +
      'gap of zero.',
  })
  @ApiEnvelopeResponse(AdviceDto, { description: 'The advice.' })
  async adviceForRecommended(@Req() req: DataAsOfRequest): Promise<AdviceDto> {
    const advice = await this.insights.adviseRecommended();
    markDataAsOf(req, advice.gameweekId);
    return advice;
  }

  @Get('advice/:managerId')
  @ApiOperation({
    summary: 'Advice for a previously imported squad.',
    description:
      "Captain, vice, bench order and the gap against the best legal 15, with the model's " +
      'per-term reasoning on every player. Does NOT recommend transfers or chips — see ' +
      '`notAdvisedOn` in the response, and B-008.',
  })
  @ApiParam({ name: 'managerId', type: Number, example: 1 })
  @ApiEnvelopeResponse(AdviceDto, { description: 'The advice.' })
  @ApiEnvelopeError(
    404,
    SquadErrorCode.SQUAD_NOT_IMPORTED,
    'Import the squad first: POST /api/squad/import.',
  )
  async adviceForManager(
    @Param('managerId', ParseIntPipe) managerId: number,
    @Req() req: DataAsOfRequest,
  ): Promise<AdviceDto> {
    const advice = await this.insights.adviseManager(managerId);
    markDataAsOf(req, advice.gameweekId);
    return advice;
  }
}
