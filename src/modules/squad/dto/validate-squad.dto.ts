import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * A squad to check. Player ids only — prices, positions and clubs are read from our own store, so
 * a client cannot claim a £4.0m Haaland by sending one.
 */
export class ValidateSquadDto {
  @ApiProperty({
    type: [String],
    description: 'Our internal player ids (cuid). Order does not matter here.',
  })
  @IsArray()
  @IsString({ each: true })
  // Bounded either side: the real check is against the configured squad size, but an unbounded
  // array is a query with no ceiling.
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  playerIds!: string[];
}

export class ViolationDto {
  @ApiProperty({
    enum: [
      'SQUAD_SIZE',
      'POSITION_QUOTA',
      'BUDGET_EXCEEDED',
      'CLUB_LIMIT',
      'DUPLICATE_PLAYER',
      'NO_LEGAL_FORMATION',
    ],
  })
  code!: string;

  @ApiProperty({ description: 'Written for a person, not a log.' })
  message!: string;
}

export class SquadValidationDto {
  @ApiProperty()
  legal!: boolean;

  @ApiProperty({
    type: [ViolationDto],
    description:
      'EVERY broken rule, not just the first. A builder that reports one violation at a time ' +
      'makes the user play twenty questions with the form.',
  })
  violations!: ViolationDto[];

  @ApiProperty({ description: 'Total cost in tenths of a million.' })
  totalCost!: number;

  @ApiProperty({
    description: 'Budget minus cost, in tenths. Negative means over budget.',
  })
  bank!: number;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'How many of each position, against the quota.',
  })
  positionCounts!: Record<string, number>;

  @ApiProperty({
    type: 'object',
    additionalProperties: { type: 'number' },
    description: 'How many from each club, against the 3-per-club limit.',
  })
  clubCounts!: Record<string, number>;
}
