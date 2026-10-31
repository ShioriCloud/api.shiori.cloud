import { Column, CreateDateColumn, Entity, Index, PrimaryColumn } from 'typeorm';

@Entity('user_social_feed_likes')
@Index(['activityKey', 'createdAt'])
export class UserSocialFeedLike {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @PrimaryColumn({ type: 'text', name: 'activity_key' })
  activityKey: string;

  @Column({ type: 'text', name: 'activity_type', nullable: true })
  activityType: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
