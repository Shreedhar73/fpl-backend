import { Module } from '@nestjs/common';
import { PrismaModule } from '../../infra/prisma/prisma.module';
import { GameweeksController } from './gameweeks.controller';
import { GameweeksRepository } from './gameweeks.repository';
import { GameweeksService } from './gameweeks.service';

/** The calendar as the frontend needs it: the next deadline and the horizon (plan 032). */
@Module({
  imports: [PrismaModule],
  controllers: [GameweeksController],
  providers: [GameweeksService, GameweeksRepository],
  exports: [GameweeksService],
})
export class GameweeksModule {}
