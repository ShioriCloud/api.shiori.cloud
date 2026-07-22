import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('sponsor_campaigns')
export class SponsorCampaign {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'channel_id' })
  channelId: string;

  @Column({ type: 'text', name: 'channel_username', nullable: true })
  channelUsername: string | null;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'int', name: 'target_count' })
  targetCount: number;

  @Column({ type: 'int', name: 'joined_count', default: 0 })
  joinedCount: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
