import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { ScheduleModule } from '@nestjs/schedule';
import { PrismaModule } from './infra/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { FplSyncModule } from './modules/fpl-sync/fpl-sync.module';
import { ProjectionsModule } from './modules/projections/projections.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ScheduleModule.forRoot(),
    PrismaModule,
    HealthModule,
    FplSyncModule,
    ProjectionsModule,
    // Domain modules land here: players, fixtures, teams, squad,
    // optimizer, insights. One directory each under src/modules/ — see fpl-architecture-contract.
  ],
})
export class AppModule {}
