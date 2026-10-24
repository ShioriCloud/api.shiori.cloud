import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_social_blocks')
@Unique(['blockerTelegramUserId', 'blockedTelegramUserId'])
@Index(['blockedTelegramUserId', 'createdAt'])
export class UserSocialBlock {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'blocker_telegram_user_id' })
  blockerTelegramUserId: string;

  @Column({ type: 'bigint', name: 'blocked_telegram_user_id' })
  blockedTelegramUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
