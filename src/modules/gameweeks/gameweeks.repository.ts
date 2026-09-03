import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../infra/prisma/prisma.service';

export interface UpcomingGameweekRow {
  id: number;
  name: string;
  deadlineTime: Date;
}

/** The only file in this module that touches Prisma — fpl-architecture-contract §2. */
@Injectable()
export class GameweeksRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * The next `n` gameweeks whose deadline has not passed, in order. The same predicate as
   * `PlayersRepository.horizonGameweeks` and the optimizer's universe — one read of the clock,
   * so the horizon the board shows is the horizon the advice was solved over.
   */
  async upcoming(n: number, now: Date): Promise<UpcomingGameweekRow[]> {
    return this.prisma.gameweek.findMany({
      where: { finished: false, deadlineTime: { gt: now } },
      orderBy: { id: 'asc' },
      take: n,
      select: { id: true, name: true, deadlineTime: true },
    });
  }
}
