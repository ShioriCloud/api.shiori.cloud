import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeAutomationConfig,
  AnimeSourceProfile,
  AutomationJob,
  AutomationJobEvent,
  SubtitleSubmission,
  TelegramUser,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { BotModule } from '../bot/bot.module';
import { TelegramDmModule } from '../telegram-dm/telegram-dm.module';
import { AutomationService } from './automation.service';
import { AutomationAdminController } from './automation-admin.controller';
import { AutomationBotController } from './automation-bot.controller';

@Module({
  imports: [
    PortalAuthModule,
    BotModule,
    TelegramDmModule,
    TypeOrmModule.forFeature([
      Anime,
      AnimeAutomationConfig,
      AnimeSourceProfile,
      AutomationJob,
      AutomationJobEvent,
      SubtitleSubmission,
      TelegramUser,
    ]),
  ],
  controllers: [AutomationAdminController, AutomationBotController],
  providers: [AutomationService],
  exports: [AutomationService],
})
export class AutomationModule {}
