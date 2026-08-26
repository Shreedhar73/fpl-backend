import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PrismaModule } from './infra/prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    // Domain modules land here: fpl-sync, players, fixtures, teams, squad, projections,
    // optimizer, insights. One directory each under src/modules/ — see fpl-architecture-contract.
  ],
})
export class AppModule {}
