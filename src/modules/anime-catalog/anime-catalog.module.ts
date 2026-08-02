import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeStudioLink,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
  BotFile,
  UserAnimeListEntry,
} from '../../entities';
import { AnimeCatalogController } from './anime-catalog.controller';
import { AnimeCatalogService } from './anime-catalog.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Anime,
      AnimeGenre,
      AnimeGenreLink,
      AnimeStudio,
      AnimeStudioLink,
      AnimeEpisode,
      AnimeSubtitle,
      AnimeSubtitlePack,
      AnimeTranslator,
      AnimeTranslatorLink,
      AnimeSeriesMember,
      UserAnimeListEntry,
      BotFile,
    ]),
  ],
  controllers: [AnimeCatalogController],
  providers: [AnimeCatalogService],
  exports: [AnimeCatalogService],
})
export class AnimeCatalogModule {}
