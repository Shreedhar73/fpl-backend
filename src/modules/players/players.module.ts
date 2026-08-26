import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { PlayersController } from './players.controller';
import { PlayersRepository } from './players.repository';
import { PlayersService } from './players.service';

/**
 * The player universe (B-006, Phase 2): what the squad builder picks from. Reads Postgres only —
 * the FPL sync is what puts the rows there.
 */
@Module({
  imports: [PrismaModule],
  controllers: [PlayersController],
  providers: [PlayersService, PlayersRepository],
  exports: [PlayersService],
})
export class PlayersModule {}
