import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '../../generated/prisma/client';

/**
 * The only place a PrismaClient is constructed. Repositories inject this; nothing else imports
 * the generated client directly — see the fpl-architecture-contract skill, §2.
 *
 * Prisma 7 takes a driver adapter rather than reading DATABASE_URL itself; the URL for the CLI
 * (migrate, studio) lives in prisma.config.ts.
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor() {
    super({
      adapter: new PrismaPg({
        connectionString: process.env.DATABASE_URL,
        // EVERY timestamptz this client writes depends on this line.
        //
        // The adapter sends a timestamp as a string with no offset, so Postgres resolves it in the
        // SESSION timezone. On a machine set to Asia/Kathmandu that silently moved every written
        // instant by 5h45m: GW2's deadline came back as 11:45 UTC when upstream says 17:30 UTC, and
        // `deadline_time_epoch` settles it (1787938200, not 1787917500). Raw `pg` round-trips the
        // same Date correctly, which is what narrows the fault to this boundary.
        //
        // Nothing looked wrong. The value displayed plausibly, sorted correctly, and every
        // comparison the app makes is between two equally shifted values — so "has the deadline
        // passed", "which gameweek is next" and the whole horizon all behaved, while the app was
        // 5h45m wrong about when a deadline actually falls. It surfaced only because a snapshot
        // reported being 48.4 hours from a deadline that was 42.7 hours away.
        //
        // Forcing the session to UTC makes the offsetless string mean what it says. Do not remove
        // this because "the database is in UTC" — the database is; the SESSION resolves the
        // timestamp, and the session follows the machine that opened it.
        options: '-c timezone=UTC',
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
    await this.assertUtcSession();
  }

  /**
   * Refuse to run on a connection that is not in UTC.
   *
   * The bug this guards was invisible for the whole life of the project: every comparison the app
   * makes is between two equally shifted values, so nothing misbehaved while every stored deadline
   * was 5h45m wrong. A silent offset deserves a loud check — this one goes red on the connection
   * rather than waiting for someone to notice a projection is for the wrong gameweek.
   */
  private async assertUtcSession(): Promise<void> {
    const rows =
      await this.$queryRaw<{ TimeZone: string }[]>`SHOW TIMEZONE`;
    const tz = rows[0]?.TimeZone;
    if (tz !== 'UTC') {
      throw new Error(
        `database session timezone is "${tz}", not UTC. Timestamps are sent without an offset and ` +
          `Postgres resolves them in the session zone, so every timestamptz written would be shifted ` +
          `by the machine's offset. Check the adapter's \`options: '-c timezone=UTC'\`.`,
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
