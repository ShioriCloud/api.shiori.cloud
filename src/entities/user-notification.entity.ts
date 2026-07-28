import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationCampaign } from './notification-campaign.entity';
import { decimalNumberTransformer } from './decimal-number.transformer';

@Entity('user_notifications')
export class UserNotification {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'text' })
  kind: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text' })
  message: string;

  @Column({ type: 'text', nullable: true })
  href: string | null;

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

  @Column({ type: 'uuid', name: 'campaign_id', nullable: true })
  campaignId: string | null;

  @Column({ type: 'boolean', name: 'is_read', default: false })
  isRead: boolean;

  @Column({ type: 'timestamptz', name: 'telegram_sent_at', nullable: true })
  telegramSentAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => NotificationCampaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: NotificationCampaign | null;
}
