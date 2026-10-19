import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeAutomationConfig,
  AnimeSourceProfile,
  AutomationJob,
  AutomationJobEvent,
  SubtitleSubmission,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { BotModule } from '../bot/bot.module';
import { AutomationService } from './automation.service';
import { AutomationAdminController } from './automation-admin.controller';
import { AutomationBotController } from './automation-bot.controller';

@Module({
  imports: [
    PortalAuthModule,
    BotModule,
    TypeOrmModule.forFeature([
      Anime,
      AnimeAutomationConfig,
      AnimeSourceProfile,
      AutomationJob,
      AutomationJobEvent,
      SubtitleSubmission,
    ]),
  ],
  controllers: [AutomationAdminController, AutomationBotController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
