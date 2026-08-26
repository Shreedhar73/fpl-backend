import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { FplInfraModule } from '../../infra/fpl/fpl-infra.module';
import { OptimizerModule } from '../optimizer/optimizer.module';
import { SquadController } from './squad.controller';
import { SquadRepository } from './squad.repository';
import { SquadService } from './squad.service';

/**
 * The user's squad (B-006): imported from a public manager id, or taken from the optimizer.
 * Depends on OptimizerModule through its exported service only — never its repository or DTOs
 * (fpl-architecture-contract §2), and exports only its own service for the same reason: `insights`
 * reads a squad through SquadService and has no way to reach SquadRepository.
 */
@Module({
  imports: [PrismaModule, FplInfraModule, OptimizerModule],
  controllers: [SquadController],
  providers: [SquadService, SquadRepository],
  exports: [SquadService],
})
export class SquadModule {}
