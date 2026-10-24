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
import { AnimeCommentsController } from './anime-comments.controller';
import { AnimeCommentsService } from './anime-comments.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      AnimeComment,
      AnimeCommentLike,
      AnimeCommentReport,
      Anime,
      TelegramUser,
      UserNotification,
    ]),
  ],
  controllers: [AnimeCommentsController],
  providers: [AnimeCommentsService],
})
export class AnimeCommentsModule {}
