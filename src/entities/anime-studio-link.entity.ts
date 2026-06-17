import { Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Anime } from './anime.entity';
import { AnimeStudio } from './anime-studio.entity';

@Entity('anime_studios')
export class AnimeStudioLink {
  @PrimaryColumn({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @PrimaryColumn({ type: 'uuid', name: 'studio_id' })
  studioId: string;

  @ManyToOne(() => Anime, (anime) => anime.studioLinks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;

  @ManyToOne(() => AnimeStudio, (studio) => studio.animeLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'studio_id' })
  studio: AnimeStudio;
}
