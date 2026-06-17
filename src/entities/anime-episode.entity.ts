import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';

@Entity('episodes')
export class AnimeEpisode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'int', name: 'episode_number', nullable: true })
  episodeNumber: number | null;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'download_link', nullable: true })
  downloadLink: string | null;

  @ManyToOne(() => Anime, (anime) => anime.episodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
