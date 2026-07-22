import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { SponsorCampaign } from './sponsor-campaign.entity';

@Entity('sponsor_join_events')
@Unique(['campaignId', 'telegramUserId'])
@Index('idx_sponsor_join_events_campaign_verified', ['campaignId', 'verifiedAt'])
export class SponsorJoinEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'campaign_id' })
  campaignId: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'verified_at' })
  verifiedAt: Date;

  @ManyToOne(() => SponsorCampaign, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'campaign_id' })
  campaign?: SponsorCampaign;
}
