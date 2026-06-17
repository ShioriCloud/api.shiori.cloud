import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';
import { AnimeSeries } from './anime-series.entity';

@Entity('anime_series_members')
export class AnimeSeriesMember {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'series_id' })
  seriesId: string;

  @Column({ type: 'uuid', name: 'anime_id', unique: true })
  animeId: string;

  @Column({ type: 'int', name: 'sort_order', default: 1 })
  sortOrder: number;

  @Column({ type: 'text', name: 'label_fa', nullable: true })
  labelFa: string | null;

  @ManyToOne(() => AnimeSeries, (series) => series.members, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'series_id' })
  series: AnimeSeries;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
