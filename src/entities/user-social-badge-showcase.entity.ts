import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('user_social_badge_showcase')
export class UserSocialBadgeShowcase {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @PrimaryColumn({ type: 'smallint', name: 'slot' })
  slot: number;

  @Column({ type: 'text', name: 'badge_id' })
  badgeId: string;
}
