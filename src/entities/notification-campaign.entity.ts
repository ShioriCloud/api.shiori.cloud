import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { Anime } from './anime.entity';
import { TelegramUser } from './telegram-user.entity';
import { decimalNumberTransformer } from './decimal-number.transformer';

@Entity('notification_campaigns')
export class NotificationCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', default: 'new_episode' })
  kind: string;

  @Column({ type: 'uuid', name: 'anime_id', nullable: true })
  animeId: string | null;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'episode_number',
    nullable: true,
    transformer: decimalNumberTransformer,
  })
  episodeNumber: number | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'int', name: 'recipient_count', default: 0 })
  recipientCount: number;

  @Column({ type: 'int', name: 'telegram_sent_count', default: 0 })
  telegramSentCount: number;

  @Column({ type: 'bigint', name: 'created_by', nullable: true })
  createdBy: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime | null;

  @ManyToOne(() => TelegramUser, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'created_by' })
  creator: TelegramUser | null;
}
