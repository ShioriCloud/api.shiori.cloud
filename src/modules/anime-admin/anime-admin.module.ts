import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
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
  UserAnimeListEntry,
  UserNotification,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { ExternalScoresModule } from '../external-scores/external-scores.module';
import { NotificationsAdminModule } from '../notifications-admin/notifications-admin.module';
import { BotModule } from '../bot/bot.module';
import { AnimeAdminController } from './anime-admin.controller';
import { AnimeAdminService } from './anime-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    ExternalScoresModule,
    NotificationsAdminModule,
    BotModule,
    TypeOrmModule.forFeature([
      Anime,
      AnimeEpisode,
      AnimeGenre,
      AnimeGenreLink,
      AnimeStudio,
      AnimeStudioLink,
      AnimeSubtitle,
      AnimeSubtitlePack,
      AnimeSeries,
      AnimeSeriesMember,
      AnimeTranslator,
      AnimeTranslatorLink,
      UserAnimeListEntry,
      UserNotification,
    ]),
  ],
  controllers: [AnimeAdminController],
  providers: [AnimeAdminService],
})
export class AnimeAdminModule {}
