import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { CalibrationService } from './calibration.service';
import { CalibrationRepository } from './calibration.repository';
import { ForecastService } from './forecast.service';
import { ForecastRepository } from './forecast.repository';

/**
 * The calibration harness and the model fit (B-007 Phases 3 and 4). Reads the archive, writes a
 * report file, and never writes a projection — a backtest row in `projections` would become the
 * newest by `createdAt` and be served as the live model version.
 *
 * No controller: nothing here is on a request path.
 */
@Module({
  imports: [PrismaModule],
  providers: [
    CalibrationService,
    CalibrationRepository,
    ForecastService,
    ForecastRepository,
  ],
  exports: [CalibrationService, ForecastService],
})
export class CalibrationModule {}
