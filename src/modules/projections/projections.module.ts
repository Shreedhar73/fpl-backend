import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { ProjectionsService } from './projections.service';
import { ProjectionsRepository } from './projections.repository';

/**
 * The projection half of the recommendation engine (B-004): expected points per player per gameweek
 * from the synced public data. Reads Postgres, writes `projections`; no FPL calls, no HTTP endpoint
 * (the read API is B-006). Exports the service so the `pnpm project` CLI and the optimizer (B-005) use it.
 */
@Module({
  imports: [PrismaModule],
  providers: [ProjectionsService, ProjectionsRepository],
  exports: [ProjectionsService],
})
export class ProjectionsModule {}
