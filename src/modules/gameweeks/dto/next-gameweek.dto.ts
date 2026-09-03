import { ApiProperty } from '@nestjs/swagger';

/**
 * The gameweek a decision can still be made for, and the horizon the advice is solved over
 * (plan 032). The one place the deadline reaches the frontend: plans 008 and 030 both scoped a
 * countdown out because no DTO carried it, and a date hardcoded from a session brief would go
 * stale and bypass the data path.
 */
export class NextGameweekDto {
  @ApiProperty({ description: 'FPL’s event id, e.g. 3.' })
  id!: number;

  @ApiProperty({ example: 'Gameweek 3' })
  name!: string;

  @ApiProperty({
    description:
      'ISO 8601, UTC. The moment picks lock — the clock every screen counts down to.',
    example: '2026-09-04T17:30:00.000Z',
  })
  deadlineTime!: string;

  @ApiProperty({
    type: [Number],
    description:
      'This gameweek and the ones after it that the advice is solved over, in order — the same ' +
      'read of the calendar the optimizer makes, so a horizon column on screen is the horizon in ' +
      'the numbers.',
  })
  horizonGameweekIds!: number[];
}
