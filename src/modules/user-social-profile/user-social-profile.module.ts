import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Anime, TelegramUser, UserAnimeListEntry } from '../../entities';
import { UserSocialProfileController } from './user-social-profile.controller';
import { UserSocialProfileService } from './user-social-profile.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUser, UserAnimeListEntry, Anime]),
  ],
  controllers: [UserSocialProfileController],
  providers: [UserSocialProfileService],
})
export class UserSocialProfileModule {}
