import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeTranslator,
  AnimeTranslatorLink,
  TelegramUser,
  UserAnimeListEntry,
  UserSocialFollow,
} from '../../entities';
import { UserSocialProfileController } from './user-social-profile.controller';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramUser,
      UserAnimeListEntry,
      UserSocialFollow,
      Anime,
      AnimeTranslator,
      AnimeTranslatorLink,
    ]),
  ],
  controllers: [UserSocialProfileController],
  providers: [UserSocialProfileService],
})
export class UserSocialProfileModule {}
