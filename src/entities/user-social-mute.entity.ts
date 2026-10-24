import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_social_mutes')
@Unique(['muterTelegramUserId', 'mutedTelegramUserId'])
@Index(['muterTelegramUserId', 'createdAt'])
export class UserSocialMute {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'muter_telegram_user_id' })
  muterTelegramUserId: string;

  @Column({ type: 'bigint', name: 'muted_telegram_user_id' })
  mutedTelegramUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
