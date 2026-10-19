import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeries,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeStudioLink,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
  BotFile,
  BotFileDownloadEvent,
  BotSetting,
  FilePack,
  FilePackItem,
  NotificationCampaign,
  MediaAsset,
  TelegramLinkToken,
  TelegramUser,
  UserAnimeAiringReminder,
  UserAnimeListEntry,
  UserSocialFollow,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserPortalSession,
  DownloadTokenLedger,
  HomeBlock,
  BootQuote,
  SponsorCampaign,
  SponsorJoinEvent,
  ChannelPostDraft,
  SupportTicket,
  SupportTicketMessage,
  TelegramDmOutbox,
  AdminAuditEvent,
  AnimeAutomationConfig,
  AnimeSourceProfile,
  AutomationJob,
  AutomationJobEvent,
  SubtitleSubmission,
} from './entities';
import { HomeModule } from './modules/home/home.module';
import { AutomationModule } from './modules/automation/automation.module';
import { HomeAdminModule } from './modules/home-admin/home-admin.module';
import { BootQuotesModule } from './modules/boot-quotes/boot-quotes.module';
import { BootQuotesAdminModule } from './modules/boot-quotes-admin/boot-quotes-admin.module';
import { AnimeCatalogModule } from './modules/anime-catalog/anime-catalog.module';
import { AnimeNotificationsModule } from './modules/anime-notifications/anime-notifications.module';
import { AppAuthModule } from './modules/app-auth/app-auth.module';
import { HealthModule } from './modules/health/health.module';
import { TelegramUsersModule } from './modules/telegram-users/telegram-users.module';
import { UserAnimeListModule } from './modules/user-anime-list/user-anime-list.module';
import { UserCustomListsModule } from './modules/user-custom-lists/user-custom-lists.module';
import { AnimeAdminModule } from './modules/anime-admin/anime-admin.module';
import { PortalAuthModule } from './modules/portal-auth/portal-auth.module';
import { FilesAdminModule } from './modules/files-admin/files-admin.module';
import { NotificationsAdminModule } from './modules/notifications-admin/notifications-admin.module';
import { TelegramUsersAdminModule } from './modules/telegram-users-admin/telegram-users-admin.module';
import { MediaAdminModule } from './modules/media-admin/media-admin.module';
import { BotModule } from './modules/bot/bot.module';
import { MembershipAdminModule } from './modules/membership-admin/membership-admin.module';
import { DownloadTokensModule } from './modules/download-tokens/download-tokens.module';
import { SubscriptionsModule } from './modules/subscriptions/subscriptions.module';
import { SupportTicketsModule } from './modules/support-tickets/support-tickets.module';
import { ScoreSyncModule } from './modules/score-sync/score-sync.module';
import { UserSocialProfileModule } from './modules/user-social-profile/user-social-profile.module';
import { TelegramDmModule } from './modules/telegram-dm/telegram-dm.module';
import { TelegramModule } from './telegram/telegram.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        synchronize: config.get<boolean>('database.sync', false),
        entities: [
          Anime,
          AnimeGenre,
          AnimeGenreLink,
          AnimeStudio,
          AnimeStudioLink,
          AnimeEpisode,
          AnimeSubtitle,
          AnimeSubtitlePack,
          AnimeTranslator,
          AnimeTranslatorLink,
          AnimeSeries,
          AnimeSeriesMember,
          UserAnimeAiringReminder,
          UserAnimeListEntry,
          UserSocialFollow,
          UserCustomList,
          UserCustomListItem,
          TelegramUser,
          UserNotification,
          UserPortalSession,
          BotFile,
          BotFileDownloadEvent,
          BotSetting,
          FilePack,
          FilePackItem,
          NotificationCampaign,
          TelegramLinkToken,
          MediaAsset,
          DownloadTokenLedger,
          HomeBlock,
          BootQuote,
          SponsorCampaign,
          SponsorJoinEvent,
          ChannelPostDraft,
          SupportTicket,
          SupportTicketMessage,
          TelegramDmOutbox,
          AdminAuditEvent,
          AnimeAutomationConfig,
          AnimeSourceProfile,
          AutomationJob,
          AutomationJobEvent,
          SubtitleSubmission,
        ],
      }),
    }),
    HomeModule,
    HomeAdminModule,
    BootQuotesModule,
    BootQuotesAdminModule,
    TelegramModule,
    TelegramDmModule,
    HealthModule,
    AnimeCatalogModule,
    TelegramUsersModule,
    UserAnimeListModule,
    UserCustomListsModule,
    AnimeNotificationsModule,
    AppAuthModule,
    PortalAuthModule,
    AnimeAdminModule,
    TelegramUsersAdminModule,
    FilesAdminModule,
    NotificationsAdminModule,
    MediaAdminModule,
    BotModule,
    MembershipAdminModule,
    DownloadTokensModule,
    SubscriptionsModule,
    SupportTicketsModule,
    ScoreSyncModule,
    UserSocialProfileModule,
    AutomationModule,
  ],
})
export class AppModule {}
