import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Anime } from './anime.entity';
import { TelegramUser } from './telegram-user.entity';

@Entity('user_anime_airing_reminders')
@Unique(['telegramUserId', 'animeId'])
export class UserAnimeAiringReminder {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => TelegramUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'telegram_user_id' })
  user: TelegramUser;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
