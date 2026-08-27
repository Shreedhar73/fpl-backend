import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { CalibrationService } from './calibration.service';
import { CalibrationRepository } from './calibration.repository';
import { DecisionService } from './decision.service';
import { ComponentCalibrationService } from './component-calibration.service';
import { ServedScoringService } from './served-scoring.service';
import { XiReplayService } from './xi-replay.service';
import { CollisionCorrelationService } from './collision-correlation.service';
import { ObjectiveAbService } from './objective-ab.service';
import { ProjectionsModule } from '../projections/projections.module';

/**
 * The calibration harness and the model fit (B-007 Phases 3 and 4). Reads the archive, writes a
 * report file, and never writes a projection — a backtest row in `projections` would become the
 * newest by `createdAt` and be served as the live model version.
 *
 * No controller: nothing here is on a request path.
 */
@Module({
  imports: [PrismaModule, ProjectionsModule],
  providers: [
    CalibrationService,
    CalibrationRepository,
    DecisionService,
    ComponentCalibrationService,
    ServedScoringService,
    XiReplayService,
    CollisionCorrelationService,
    ObjectiveAbService,
  ],
  exports: [
    CalibrationService,
    DecisionService,
    ComponentCalibrationService,
    ServedScoringService,
    XiReplayService,
    CollisionCorrelationService,
    ObjectiveAbService,
  ],
})
export class CalibrationModule {}
