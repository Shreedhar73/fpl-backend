import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { OptimizerService } from './optimizer.service';
import { OptimizerRepository } from './optimizer.repository';

/**
 * Squad selection (B-005): the ILP that turns B-004's projections into the best legal 15. Reads
 * Postgres, writes `optimizer_runs`; no FPL calls, no HTTP endpoint (the read API is B-006). Exports
 * the service so the `pnpm optimize` CLI and B-006 use it.
 */
@Module({
  imports: [PrismaModule],
  providers: [OptimizerService, OptimizerRepository],
  exports: [OptimizerService],
})
export class OptimizerModule {}
