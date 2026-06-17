import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';

@Entity('subtitles')
export class AnimeSubtitle {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'int', name: 'episode_number' })
  episodeNumber: number;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'subtitle_link', nullable: true })
  subtitleLink: string | null;

  @ManyToOne(() => Anime, (anime) => anime.subtitles, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
