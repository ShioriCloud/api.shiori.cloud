import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
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
      AnimeEpisode,
      AnimeSubtitle,
      AnimeSubtitlePack,
      AnimeTranslator,
      AnimeTranslatorLink,
      AnimeSeriesMember,
      UserAnimeListEntry,
    ]),
  ],
  controllers: [AnimeCatalogController],
  providers: [AnimeCatalogService],
})
export class AnimeCatalogModule {}
