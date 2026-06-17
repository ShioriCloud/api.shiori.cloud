import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AnimeSeriesMember } from './anime-series-member.entity';

@Entity('anime_series')
export class AnimeSeries {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', default: '' })
  title: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @OneToMany(() => AnimeSeriesMember, (member) => member.series)
  members: AnimeSeriesMember[];
}
