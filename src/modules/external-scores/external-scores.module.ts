import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Anime } from '../../entities';
import { CronAuthGuard } from './cron-auth.guard';
import { ExternalScoresController } from './external-scores.controller';
import { ExternalScoresService } from './external-scores.service';

@Module({
  imports: [TypeOrmModule.forFeature([Anime])],
  controllers: [ExternalScoresController],
  providers: [ExternalScoresService, CronAuthGuard],
  exports: [ExternalScoresService],
})
export class ExternalScoresModule {}
