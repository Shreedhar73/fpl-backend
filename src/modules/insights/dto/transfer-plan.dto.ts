import { ApiProperty } from '@nestjs/swagger';

/**
 * The transfer plan (B-008), and the three things it says out loud that a plan usually does not.
 *
 * 1. **Where each sell value came from.** FPL exposes neither purchase nor selling price publicly
 *    (D-013), so every one of these is reconstructed. A consumer can tell an exact number from an
 *    inferred one, which matters because a sell value that is quietly the market price overstates a
 *    budget in the direction that produces a plan the manager cannot afford.
 * 2. **Whether the free-transfer count is complete.** It is a replay of the manager's own gameweek
 *    history; a gap in that history makes the count a lower bound and the payload says so.
 * 3. **That the chips are windows, not decisions.** A chip is unspendable once used.
 */

export class TransferSideDto {
  @ApiProperty()
  playerId!: string;

  @ApiProperty()
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty()
  teamShortName!: string;

  @ApiProperty({ description: 'Market price in tenths of a million.' })
  nowCost!: number;

  @ApiProperty({ description: 'Horizon expected points, decayed.' })
  epHorizon!: number;
}

export class TransferOutDto extends TransferSideDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'What selling returns, in tenths: purchase price plus half the rise, rounded down. Null when ' +
      'the purchase price could not be reconstructed at all.',
  })
  sellValue!: number | null;

  @ApiProperty({
    enum: ['transfer-log', 'starting-gameweek-price', 'unknown'],
    description:
      "Where the purchase price came from. 'transfer-log' is exact — the manager's own " +
      "element_in_cost. 'starting-gameweek-price' is exact for a player held since their first " +
      "gameweek, because FPL's per-gameweek value IS the price that week. 'unknown' means the " +
      'budget used the market price, which overstates it.',
  })
  sellValueSource!: 'transfer-log' | 'starting-gameweek-price' | 'unknown';
}

export class PlannedMoveDto {
  @ApiProperty({ type: TransferOutDto })
  out!: TransferOutDto;

  @ApiProperty({ type: TransferSideDto })
  in!: TransferSideDto;

  @ApiProperty({
    description:
      'Horizon EP this single move adds, before any hit. The hit is charged once against the plan, ' +
      'not per move, because it is a property of how many moves there are.',
  })
  gainEp!: number;
}

export class ChipAdviceDto {
  @ApiProperty({ enum: ['bboost', '3xc', 'freehit', 'wildcard', 'manager'] })
  chip!: 'bboost' | '3xc' | 'freehit' | 'wildcard' | 'manager';

  @ApiProperty()
  label!: string;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The gameweek the CALENDAR argues for, or null when none in the horizon does — which is the ' +
      'common answer early in a season, not a failure. Never a gameweek for the wildcard: nothing ' +
      'in a fixture list argues for one.',
  })
  gameweekId!: number | null;

  @ApiProperty({ description: 'Why, in the words a user would use.' })
  reason!: string;

  @ApiProperty({ description: 'Already used, so there is nothing to advise.' })
  spent!: boolean;
}

export class TransferPlanDto {
  @ApiProperty()
  managerId!: number;

  @ApiProperty({ description: 'The gameweek the plan is for — the next one.' })
  gameweekId!: number;

  @ApiProperty({ type: [Number] })
  horizonGameweekIds!: number[];

  @ApiProperty()
  modelVersion!: string;

  @ApiProperty({
    description:
      "Free transfers in hand, replayed from the manager's own gameweek history. FPL exposes no " +
      'free-transfer count publicly.',
  })
  freeTransfers!: number;

  @ApiProperty({
    description:
      'False when that replay had a gap in it, which makes the count a lower bound rather than a ' +
      'number.',
  })
  freeTransfersReconstructed!: boolean;

  @ApiProperty({ description: 'Bank, in tenths of a million.' })
  bank!: number;

  @ApiProperty({
    type: [PlannedMoveDto],
    description:
      'Empty means hold — the solver always has holding available to it, so an empty plan is a ' +
      'decision and not a missing answer.',
  })
  moves!: PlannedMoveDto[];

  @ApiProperty({ description: 'Transfers beyond the free ones.' })
  hits!: number;

  @ApiProperty({ description: 'Points those hits cost, as a positive number.' })
  hitCost!: number;

  @ApiProperty({ description: 'Horizon EP of the squad as it stands.' })
  currentEp!: number;

  @ApiProperty({
    description: 'Horizon EP after the moves, with the hit already subtracted.',
  })
  plannedEp!: number;

  @ApiProperty({
    description:
      'plannedEp − currentEp. Never negative: holding is always in the solver’s feasible set.',
  })
  netGainEp!: number;

  @ApiProperty({
    type: [String],
    description:
      'Picks whose sell value could not be reconstructed, so the budget used their market price.',
  })
  sellValueUnknown!: string[];

  @ApiProperty({ type: [ChipAdviceDto] })
  chips!: ChipAdviceDto[];

  @ApiProperty({
    type: [String],
    description:
      'What this plan is not, in the payload rather than only in a plan file.',
  })
  caveats!: string[];
}
