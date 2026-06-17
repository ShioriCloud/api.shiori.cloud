import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';

@Entity('subtitle_packs')
export class AnimeSubtitlePack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', name: 'subtitle_link', nullable: true })
  subtitleLink: string | null;

  @ManyToOne(() => Anime, (anime) => anime.subtitlePacks, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
