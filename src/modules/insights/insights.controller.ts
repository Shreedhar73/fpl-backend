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
import { TransferPlanRequestDto } from './dto/transfer-plan-request.dto';
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

  /**
   * The transfer plan for a fifteen nobody has bought (B-045).
   *
   * The same solve as the manager route, with the two facts that route reconstructs from a public
   * record stated by the caller instead — there is no record for a hypothetical squad — and sell
   * values equal to market prices, which for a squad assembled today is exact rather than a fallback.
   */
  @Post('transfers')
  @HttpCode(200)
  @ApiOperation({
    summary: 'What to do with a squad built by hand.',
    description:
      'The squad is validated first and refused if illegal. Sell values are today’s market prices ' +
      '(a hand-built fifteen was never bought, so that is exact by construction), the free-transfer ' +
      'count is the one stated, and the bank defaults to what the fifteen leaves of the budget. ' +
      'Chips are all unspent. The response shape is the manager route’s, with managerId null.',
  })
  @ApiEnvelopeResponse(TransferPlanDto, { description: 'The plan.' })
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
  async transferPlanForBuilt(
    @Body() body: TransferPlanRequestDto,
    @Req() req: DataAsOfRequest,
  ): Promise<TransferPlanDto> {
    const plan = await this.transfers.planBuilt(body.playerIds, {
      freeTransfers: body.freeTransfers,
      bank: body.bank,
    });
    markDataAsOf(req, plan.gameweekId);
    return plan;
  }
}
