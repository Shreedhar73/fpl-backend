import { Injectable } from '@nestjs/common';
import { HORIZON } from '../optimizer/policy';
import { NextGameweekDto } from './dto/next-gameweek.dto';
import { GameweeksError } from './gameweeks.errors';
import { GameweeksRepository } from './gameweeks.repository';

@Injectable()
export class GameweeksService {
  constructor(private readonly repo: GameweeksRepository) {}

  /**
   * The gameweek a visitor is deciding for. A 404 rather than a null when there is none: the
   * frontend has nothing to render a board around, and "no deadline" is a state worth naming
   * (season over, or the sync has never run) rather than a blank.
   */
  async next(now: Date = new Date()): Promise<NextGameweekDto> {
    const rows = await this.repo.upcoming(HORIZON, now);
    const first = rows[0];
    if (!first) throw GameweeksError.noUpcoming();
    return {
      id: first.id,
      name: first.name,
      deadlineTime: first.deadlineTime.toISOString(),
      horizonGameweekIds: rows.map((r) => r.id),
    };
  }
}
