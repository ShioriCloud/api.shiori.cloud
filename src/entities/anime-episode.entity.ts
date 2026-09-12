import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';
import { decimalNumberTransformer } from './decimal-number.transformer';

@Entity('episodes')
export class AnimeEpisode {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'episode_number',
    nullable: true,
    transformer: decimalNumberTransformer,
  })
  episodeNumber: number | null;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'download_link', nullable: true })
  downloadLink: string | null;

  /** Download category: `softsub` | `hardsub` | `free` */
  @Column({ type: 'text', name: 'video_file_type', default: 'softsub' })
  videoFileType: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Anime, (anime) => anime.episodes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
