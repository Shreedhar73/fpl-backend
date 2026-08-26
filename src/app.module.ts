import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './infra/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { FplSyncModule } from './modules/fpl-sync/fpl-sync.module';
import { ProjectionsModule } from './modules/projections/projections.module';
import { OptimizerModule } from './modules/optimizer/optimizer.module';
import { SquadModule } from './modules/squad/squad.module';
import { InsightsModule } from './modules/insights/insights.module';
import { PlayersModule } from './modules/players/players.module';
import { ArchiveModule } from './modules/archive/archive.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    FplSyncModule,
    ProjectionsModule,
    OptimizerModule,
    SquadModule,
    InsightsModule,
    PlayersModule,
    ArchiveModule,
    // Domain modules land here: fixtures, teams.
    // One directory each under src/modules/ — see fpl-architecture-contract.
  ],
})
export class AppModule {}
