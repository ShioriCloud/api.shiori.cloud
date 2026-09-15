import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Anime, BotSetting } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { ScoreSyncController } from './score-sync.controller';
import { ScoreSyncService } from './score-sync.service';

@Module({
  imports: [PortalAuthModule, TypeOrmModule.forFeature([Anime, BotSetting])],
  controllers: [ScoreSyncController],
  providers: [ScoreSyncService],
})
export class ScoreSyncModule {}
