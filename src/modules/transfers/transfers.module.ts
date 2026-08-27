import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { FplInfraModule } from '../../infra/fpl/fpl-infra.module';
import { OptimizerModule } from '../optimizer/optimizer.module';
import { SquadModule } from '../squad/squad.module';
import { TransfersService } from './transfers.service';
import { TransfersRepository } from './transfers.repository';

/**
 * Transfer planning (B-008). No controller: the plan is served through `insights`, beside the advice
 * it belongs with, so a consumer makes one call about "what should I do" rather than two.
 */
@Module({
  imports: [PrismaModule, FplInfraModule, OptimizerModule, SquadModule],
  providers: [TransfersService, TransfersRepository],
  exports: [TransfersService],
})
export class TransfersModule {}
