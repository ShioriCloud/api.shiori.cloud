import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { NotificationCampaign } from './notification-campaign.entity';

export type TelegramDmOutboxStatus =
  | 'pending'
  | 'claimed'
  | 'sent'
  | 'failed';

@Entity('telegram_dm_outbox')
@Index('idx_telegram_dm_outbox_pending', ['status', 'createdAt'])
export class TelegramDmOutbox {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id', nullable: true })
  campaignId: string | null;

  @Column({ type: 'bigint', name: 'chat_id' })
  chatId: string;

  @Column({ type: 'text' })
  text: string;

  @Column({ type: 'text', name: 'web_app_url', nullable: true })
  webAppUrl: string | null;

  @Column({ type: 'text', default: 'pending' })
  status: TelegramDmOutboxStatus;

  @Column({ type: 'text', nullable: true })
  error: string | null;

  @Column({ type: 'int', default: 0 })
  attempts: number;

  @Column({ type: 'timestamptz', name: 'claimed_at', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'sent_at', nullable: true })
  sentAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => NotificationCampaign, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'campaign_id' })
  campaign: NotificationCampaign | null;
}
