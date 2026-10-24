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
  UserNotification,
  UserSocialBadge,
  UserSocialBlock,
  UserSocialFollow,
  UserSocialMute,
} from '../../entities';
import { UserSocialProfileController } from './user-social-profile.controller';
import { UserSocialModerationService } from './user-social-moderation.service';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramUser,
      UserAnimeListEntry,
      UserSocialFollow,
      UserSocialBadge,
      UserSocialBlock,
      UserSocialMute,
      AnimeComment,
      UserCustomList,
      UserNotification,
      Anime,
      AnimeTranslator,
      AnimeTranslatorLink,
    ]),
  ],
  controllers: [UserSocialProfileController],
  providers: [UserSocialProfileService, UserSocialModerationService],
  exports: [UserSocialModerationService],
})
export class UserSocialProfileModule {}
