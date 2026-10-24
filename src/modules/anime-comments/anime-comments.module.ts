import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeComment,
  AnimeCommentLike,
  AnimeCommentReport,
  TelegramUser,
  UserNotification,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { UserSocialProfileModule } from '../user-social-profile/user-social-profile.module';
import { AnimeCommentsAdminController } from './anime-comments-admin.controller';
import { AnimeCommentsAdminService } from './anime-comments-admin.service';
import { AnimeCommentsController } from './anime-comments.controller';
import { AnimeCommentsService } from './anime-comments.service';

@Module({
  imports: [
    PortalAuthModule,
    UserSocialProfileModule,
    TypeOrmModule.forFeature([
      AnimeComment,
      AnimeCommentLike,
      AnimeCommentReport,
      Anime,
      TelegramUser,
      UserNotification,
    ]),
  ],
  controllers: [AnimeCommentsController, AnimeCommentsAdminController],
  providers: [AnimeCommentsService, AnimeCommentsAdminService],
})
export class AnimeCommentsModule {}
