import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import configuration from './config/configuration';
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
} from './entities';
import { AnimeCatalogModule } from './modules/anime-catalog/anime-catalog.module';
import { HealthModule } from './modules/health/health.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
    }),
    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        type: 'postgres',
        url: config.get<string>('database.url'),
        synchronize: config.get<boolean>('database.sync', false),
        entities: [
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
          AnimeSeries,
          AnimeSeriesMember,
          UserAnimeListEntry,
        ],
      }),
    }),
    HealthModule,
    AnimeCatalogModule,
  ],
})
export class AppModule {}
