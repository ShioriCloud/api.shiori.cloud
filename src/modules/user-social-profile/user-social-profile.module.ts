import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeTranslator,
  AnimeTranslatorLink,
  TelegramUser,
  AnimeComment,
  UserAnimeListEntry,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserSocialBadge,
  UserSocialBadgeShowcase,
  UserEpisodeDownloadReceipt,
  DownloadTokenLedger,
  UserSocialBlock,
  UserSocialFollow,
  UserSocialMute,
} from '../../entities';
import { TelegramModule } from '../../telegram/telegram.module';
import { TelegramDmModule } from '../telegram-dm/telegram-dm.module';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { SocialBadgesAdminController } from './social-badges-admin.controller';
import { UserSocialProfileController } from './user-social-profile.controller';
import { SocialBadgeEngineService } from './social-badge-engine.service';
import { SocialBadgeMetricsService } from './social-badge-metrics.service';
import { SocialNotificationDeliveryService } from './social-notification-delivery.service';
import { UserSocialModerationService } from './user-social-moderation.service';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TelegramModule,
    TelegramDmModule,
    PortalAuthModule,
    TypeOrmModule.forFeature([
      UserNotification,
      TelegramUser,
      UserAnimeListEntry,
      UserSocialFollow,
      UserSocialBadge,
      UserSocialBadgeShowcase,
      UserEpisodeDownloadReceipt,
      DownloadTokenLedger,
      UserSocialBlock,
      UserSocialMute,
      AnimeComment,
      UserCustomList,
      UserCustomListItem,
      Anime,
      AnimeTranslator,
      AnimeTranslatorLink,
    ]),
  ],
  controllers: [UserSocialProfileController, SocialBadgesAdminController],
  providers: [
    UserSocialProfileService,
    SocialBadgeMetricsService,
    SocialBadgeEngineService,
    UserSocialModerationService,
    SocialNotificationDeliveryService,
  ],
  exports: [
    UserSocialModerationService,
    SocialNotificationDeliveryService,
    SocialBadgeEngineService,
  ],
})
export class UserSocialProfileModule {}
