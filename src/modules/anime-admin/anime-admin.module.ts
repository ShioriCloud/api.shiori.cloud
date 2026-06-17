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
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { ExternalScoresModule } from '../external-scores/external-scores.module';
import { AnimeAdminController } from './anime-admin.controller';
import { AnimeAdminService } from './anime-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    ExternalScoresModule,
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
    ]),
  ],
  controllers: [AnimeAdminController],
  providers: [AnimeAdminService],
})
export class AnimeAdminModule {}
