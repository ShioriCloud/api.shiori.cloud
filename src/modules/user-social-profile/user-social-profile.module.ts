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
  UserSocialBlock,
  UserSocialFollow,
  UserSocialMute,
} from '../../entities';
import { TelegramModule } from '../../telegram/telegram.module';
import { TelegramDmModule } from '../telegram-dm/telegram-dm.module';
import { UserSocialProfileController } from './user-social-profile.controller';
import { SocialNotificationDeliveryService } from './social-notification-delivery.service';
import { UserSocialModerationService } from './user-social-moderation.service';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TelegramModule,
    TelegramDmModule,
    TypeOrmModule.forFeature([
      UserNotification,
      TelegramUser,
      UserAnimeListEntry,
      UserSocialFollow,
      UserSocialBadge,
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
  controllers: [UserSocialProfileController],
  providers: [
    UserSocialProfileService,
    UserSocialModerationService,
    SocialNotificationDeliveryService,
  ],
  exports: [UserSocialModerationService, SocialNotificationDeliveryService],
})
export class UserSocialProfileModule {}
