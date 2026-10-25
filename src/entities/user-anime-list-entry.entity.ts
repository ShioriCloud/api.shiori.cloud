import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Anime } from './anime.entity';

@Entity('user_anime_list')
@Unique(['telegramUserId', 'animeId'])
export class UserAnimeListEntry {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'int', name: 'episodes_watched', default: 0 })
  episodesWatched: number;

  @Column({
    type: 'numeric',
    precision: 3,
    scale: 1,
    name: 'user_rating',
    nullable: true,
  })
  userRating: string | null;

  /** Heart / watchlist; progress can exist without this flag. */
  @Column({ type: 'boolean', name: 'is_favorite', default: true })
  isFavorite: boolean;

  /** Lower = higher on profile favorites (null = unordered). */
  @Column({ type: 'int', name: 'favorite_rank', nullable: true })
  favoriteRank: number | null;

  @Column({ type: 'varchar', length: 20, name: 'list_status', nullable: true })
  listStatus: string | null;

  @Column({ type: 'timestamptz', name: 'list_status_at', nullable: true })
  listStatusAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
