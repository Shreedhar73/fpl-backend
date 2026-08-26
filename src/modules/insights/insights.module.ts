import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { OptimizerModule } from '../optimizer/optimizer.module';
import { SquadModule } from '../squad/squad.module';
import { InsightsController } from './insights.controller';
import { InsightsRepository } from './insights.repository';
import { InsightsService } from './insights.service';

/**
 * The "why" (B-006): captain, bench order and the gap against the optimal 15, with the model's own
 * reasoning attached. Reaches the other two modules through their exported services only.
 */
@Module({
  imports: [PrismaModule, OptimizerModule, SquadModule],
  controllers: [InsightsController],
  providers: [InsightsService, InsightsRepository],
  exports: [InsightsService],
})
export class InsightsModule {}
