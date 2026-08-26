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
      }),
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
