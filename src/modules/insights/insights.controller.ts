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
import { ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import {
  ApiEnvelopeError,
  ApiEnvelopeResponse,
} from '../../common/swagger/api-envelope.decorator';
import { markDataAsOf, type DataAsOfRequest } from '../../common/data-as-of';
import { ErrorCode } from '../../common/error-codes';
import { AdviceRequestDto } from './dto/advice-request.dto';
import { AdviceDto } from './dto/advice.dto';
import { TransferPlanDto } from './dto/transfer-plan.dto';
import { InsightsService } from './insights.service';
import { TransfersService } from '../transfers/transfers.service';

/**
 * Route order is load-bearing here too: `advice/recommended` is declared before
 * `advice/:managerId`, or the parameter route swallows the literal.
 *
 * Both responses carry model output, so both stamp `meta.dataAsOfGw`.
 */
@ApiTags('insights')
@Controller('insights')
export class InsightsController {
  constructor(
    private readonly insights: InsightsService,
    private readonly transfers: TransfersService,
  ) {}

  @Post('advice')
  @HttpCode(200)
  @ApiOperation({
    summary: 'Advice for a squad built by hand.',
    description:
      'The squad is validated first and refused if illegal: a captain and a bench for a team ' +
      'that cannot be fielded would read as encouragement.',
  })
  @ApiEnvelopeResponse(AdviceDto, { description: 'The advice.' })
  @ApiEnvelopeError(
    400,
    'SQUAD_ILLEGAL',
    'That squad breaks at least one rule — the message lists every one.',
  )
  @ApiEnvelopeError(
    409,
    ErrorCode.UNKNOWN_PLAYER,
    'One of those player ids does not exist.',
  )
  async adviceForBuilt(
    @Body() body: AdviceRequestDto,
    @Req() req: DataAsOfRequest,
  ): Promise<AdviceDto> {
    const advice = await this.insights.adviseBuilt(body.playerIds);
    markDataAsOf(req, advice.gameweekId);
    return advice;
  }

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
      'per-term reasoning on every player, and `reasoning` for what the optimizer refused. ' +
      'Transfers and chips are a separate call: GET /insights/transfers/{managerId}.',
  })
  @ApiParam({ name: 'managerId', type: Number, example: 1 })
  @ApiEnvelopeResponse(AdviceDto, { description: 'The advice.' })
  @ApiEnvelopeError(
    404,
    ErrorCode.SQUAD_NOT_IMPORTED,
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

  /**
   * The transfer plan (B-008).
   *
   * A separate route rather than a field on the advice, and deliberately so: it makes two upstream
   * on-demand calls (`entry/{id}/transfers/` and `entry/{id}/history/`) and a second ILP solve, and
   * folding that into every advice request would make the page that does not need it pay for the one
   * that does.
   */
  @Get('transfers/:managerId')
  @ApiOperation({
    summary: 'What to do with the squad this manager already has.',
    description:
      'Transfers with the −4 hit inside the objective, priced at reconstructed SELL values rather ' +
      'than market prices, plus chip WINDOWS — a chip is unspendable once used, so the model names ' +
      'the gameweek the calendar argues for and never commits one.',
  })
  @ApiParam({ name: 'managerId', type: Number, example: 1 })
  @ApiEnvelopeResponse(TransferPlanDto, { description: 'The plan.' })
  @ApiEnvelopeError(
    404,
    ErrorCode.SQUAD_NOT_IMPORTED,
    'Import the squad first: POST /api/squad/import.',
  )
  async transferPlan(
    @Param('managerId', ParseIntPipe) managerId: number,
    @Req() req: DataAsOfRequest,
  ): Promise<TransferPlanDto> {
    const plan = await this.transfers.plan(managerId);
    markDataAsOf(req, plan.gameweekId);
    return plan;
  }
}
