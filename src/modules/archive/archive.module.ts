import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { ArchiveService } from './archive.service';
import { ArchiveRepository } from './archive.repository';
import { WaybackAvailabilityService } from './wayback-availability.service';

/**
 * The third-party per-gameweek archive (B-007 Phase 2b): three completed seasons of history the
 * official API does not serve, held so the projection model can be fitted on ~87k player-gameweeks
 * rather than the one gameweek this season has produced.
 *
 * No controller, deliberately. Nothing on the serving path reads these rows — the only consumer is
 * the calibration harness, driven by `pnpm import:archive`.
 */
@Module({
  imports: [PrismaModule],
  providers: [ArchiveService, ArchiveRepository, WaybackAvailabilityService],
  exports: [ArchiveService, ArchiveRepository, WaybackAvailabilityService],
})
export class ArchiveModule {}
