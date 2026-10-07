import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';

@Entity('user_social_follows')
@Unique(['followerTelegramUserId', 'followingTelegramUserId'])
@Index(['followingTelegramUserId', 'createdAt'])
@Index(['followerTelegramUserId', 'createdAt'])
export class UserSocialFollow {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Column({ type: 'bigint', name: 'follower_telegram_user_id' })
  followerTelegramUserId: string;

  @Column({ type: 'bigint', name: 'following_telegram_user_id' })
  followingTelegramUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
