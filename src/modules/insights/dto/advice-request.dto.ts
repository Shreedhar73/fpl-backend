import { ApiProperty } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsString } from 'class-validator';

/**
 * A hand-built squad to advise on. Declared here rather than reused from the squad module: a
 * module must not import another module's `dto/` (fpl-architecture-contract §2), and the two
 * requests are free to diverge — the transfer plan's request (`TransferPlanRequestDto`) already
 * has, carrying the free transfers and the bank this one does not need.
 */
export class AdviceRequestDto {
  @ApiProperty({
    type: [String],
    description: 'Our internal player ids (cuid) for the 15.',
  })
  @IsArray()
  @IsString({ each: true })
  @ArrayMinSize(1)
  @ArrayMaxSize(30)
  playerIds!: string[];
}
