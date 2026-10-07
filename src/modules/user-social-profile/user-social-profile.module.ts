import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeTranslator,
  AnimeTranslatorLink,
  TelegramUser,
  UserAnimeListEntry,
} from '../../entities';
import { UserSocialProfileController } from './user-social-profile.controller';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramUser,
      UserAnimeListEntry,
      Anime,
      AnimeTranslator,
      AnimeTranslatorLink,
    ]),
  ],
  controllers: [UserSocialProfileController],
  providers: [UserSocialProfileService],
})
export class UserSocialProfileModule {}
