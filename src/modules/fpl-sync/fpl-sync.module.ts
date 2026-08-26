import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { FplInfraModule } from '../../infra/fpl/fpl-infra.module';
import { SyncService } from './sync.service';
import { SyncRepository } from './sync.repository';
import { SyncScheduler } from './sync.scheduler';

/**
 * The FPL public-data ingest (B-003). Owns the sync service, its repository, and the hourly
 * incremental cron. Exports the service so the CLI entry point (src/scripts/sync.ts) and later
 * modules can drive it.
 */
@Module({
  imports: [PrismaModule, FplInfraModule],
  providers: [SyncService, SyncRepository, SyncScheduler],
  exports: [SyncService],
})
export class FplSyncModule {}
