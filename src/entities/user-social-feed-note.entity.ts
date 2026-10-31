import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('user_social_feed_notes')
export class UserSocialFeedNote {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @PrimaryColumn({ type: 'text', name: 'activity_key' })
  activityKey: string;

  @Column({ type: 'text' })
  body: string;

  /** When true, only the author can see the note. Existing rows defaulted to private. */
  @Column({ type: 'boolean', name: 'is_private', default: true })
  isPrivate: boolean;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
