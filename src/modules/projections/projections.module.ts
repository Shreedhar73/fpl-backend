import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { CandidateService } from './candidate.service';
import { ProjectionsService } from './projections.service';
import { ProjectionsRepository } from './projections.repository';
import { ForecastService } from './forecast.service';
import { ForecastRepository } from './forecast.repository';

/**
 * The projection half of the recommendation engine: expected points per player per gameweek, from the
 * fitted model (B-007). Reads Postgres and the archive, writes `projections`; no FPL calls, no HTTP
 * endpoint.
 *
 * It exports `ForecastRepository` because the calibration harness reads history through it — one
 * definition of what history is, shared by the backtest and the thing being served.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    ProjectionsService,
    CandidateService,
    ProjectionsRepository,
    ForecastService,
    ForecastRepository,
  ],
  exports: [ProjectionsService,
    CandidateService, ProjectionsRepository, ForecastRepository],
})
export class ProjectionsModule {}
