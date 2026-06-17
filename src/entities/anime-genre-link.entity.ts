import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Anime } from './anime.entity';
import { AnimeGenre } from './anime-genre.entity';

@Entity('anime_genres')
export class AnimeGenreLink {
  @PrimaryColumn({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @PrimaryColumn({ type: 'uuid', name: 'genre_id' })
  genreId: string;

  @ManyToOne(() => Anime, (anime) => anime.genreLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;

  @ManyToOne(() => AnimeGenre, (genre) => genre.animeLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'genre_id' })
  genre: AnimeGenre;
}
