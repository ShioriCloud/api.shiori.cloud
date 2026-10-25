import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('user_social_badges')
export class UserSocialBadge {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @PrimaryColumn({ type: 'text', name: 'badge_id' })
  badgeId: string;

  @Column({ type: 'timestamptz', name: 'earned_at', default: () => 'now()' })
  earnedAt: Date;

  @Column({ type: 'text', name: 'unlock_source', default: 'auto' })
  unlockSource: string;
}
