import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeSubtitle,
  AutomationJob,
  AutomationJobEvent,
  BotFile,
  BotFileDownloadEvent,
  BotSetting,
  ChannelPostDraft,
  FilePack,
  FilePackItem,
  TelegramUser,
} from '../../entities';
import { SponsorCampaignsModule } from '../sponsor-campaigns/sponsor-campaigns.module';
import { TelegramDmModule } from '../telegram-dm/telegram-dm.module';
import { TelegramUsersModule } from '../telegram-users/telegram-users.module';
import { BotAuthGuard } from './bot-auth.guard';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';
import { ChannelDraftsService } from './channel-drafts.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      BotFile,
      BotFileDownloadEvent,
      FilePack,
      FilePackItem,
      BotSetting,
      Anime,
      AnimeEpisode,
      AnimeSubtitle,
      ChannelPostDraft,
      TelegramUser,
      AutomationJob,
      AutomationJobEvent,
    ]),
    SponsorCampaignsModule,
    TelegramDmModule,
    TelegramUsersModule,
  ],
  controllers: [BotController],
  providers: [BotService, BotAuthGuard, ChannelDraftsService],
  exports: [ChannelDraftsService],
})
export class BotModule {}
