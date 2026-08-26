import { ApiProperty } from '@nestjs/swagger';

/**
 * A squad as the frontend receives it. One shape for all three ways a squad arrives — imported,
 * recommended, or built — so the view that renders one renders all of them.
 *
 * Money is in tenths of a million throughout, formatted only at the render edge.
 */
export class SquadPickDto {
  @ApiProperty({
    description: 'Our internal player id (cuid), not the FPL element id.',
  })
  playerId!: string;

  @ApiProperty({ description: "The player's FPL element id." })
  fplId!: number;

  @ApiProperty({ example: 'Haaland' })
  webName!: string;

  @ApiProperty({ enum: ['GKP', 'DEF', 'MID', 'FWD'] })
  position!: 'GKP' | 'DEF' | 'MID' | 'FWD';

  @ApiProperty({ example: 'MCI' })
  teamShortName!: string;

  @ApiProperty({
    description: 'Market price in tenths of a million. 55 is £5.5m.',
  })
  nowCost!: number;

  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'What a sale would return, in tenths. NULL for an imported squad and that is correct: no ' +
      'public endpoint carries a purchase or selling price. Filled by the transfer planner (B-008).',
  })
  sellValue!: number | null;

  @ApiProperty({
    description:
      '1-11 starting XI, 12-15 bench in substitution order. Called `position` upstream, renamed ' +
      'here because a pick already has a position in the GKP/DEF/MID/FWD sense and one field ' +
      'cannot be both.',
  })
  slot!: number;

  @ApiProperty({
    description:
      '1 normally, 2 for the captain, 3 under the triple-captain chip.',
  })
  multiplier!: number;

  @ApiProperty()
  isCaptain!: boolean;

  @ApiProperty()
  isViceCaptain!: boolean;
}

export class SquadDto {
  @ApiProperty({
    type: Number,
    nullable: true,
    description:
      'The FPL manager id this squad was imported from. NULL for the recommended squad, which ' +
      'belongs to nobody.',
  })
  managerId!: number | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      "The manager's display name, when the squad came from an import.",
  })
  managerName!: string | null;

  @ApiProperty({ description: 'The gameweek this squad is the picks for.' })
  gameweekId!: number;

  @ApiProperty({ description: 'Money not spent, in tenths of a million.' })
  bank!: number;

  @ApiProperty({
    description: 'Squad value excluding the bank, in tenths of a million.',
  })
  teamValue!: number;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'The chip active in this gameweek, e.g. bboost or 3xc. Null when none.',
  })
  activeChip!: string | null;

  @ApiProperty({
    enum: ['import', 'recommended'],
    description:
      'Where this squad came from. The advice is identical either way.',
  })
  source!: 'import' | 'recommended';

  @ApiProperty({ type: [SquadPickDto] })
  picks!: SquadPickDto[];
}
