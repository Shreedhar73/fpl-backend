import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * A hand-built fifteen to plan transfers from (B-045).
 *
 * Two of the three things the manager route reconstructs from a public record do not exist for a
 * squad that was never bought, so the request states them instead: how many free transfers the
 * user holds, and — optionally — the bank. The third, what each player cost, has one honest answer
 * for a hypothetical fifteen: today's market price, by construction.
 *
 * Declared here rather than reused from the squad module: a module must not import another
 * module's `dto/` (fpl-architecture-contract §2).
 */
export class TransferPlanRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Our internal player ids (cuid) for the 15.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  playerIds!: string[];

  @ApiPropertyOptional({
    minimum: 1,
    maximum: 5,
    default: 1,
    description:
      'Free transfers in hand, as the user states them — nothing here can check the number. ' +
      'Capped at the bank FPL allows (5).',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(5)
  freeTransfers?: number;

  @ApiPropertyOptional({
    minimum: 0,
    description:
      'Bank in tenths of a million. Omitted, it is what the fifteen leaves of the budget at ' +
      "today's prices — what FPL would leave a manager who bought exactly this squad now.",
  })
  @IsOptional()
  @IsInt()
  @Min(0)
  bank?: number;
}
