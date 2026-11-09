import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { TelegramUser } from './telegram-user.entity';
import { UserCustomListItem } from './user-custom-list-item.entity';

export const USER_CUSTOM_LIST_ICONS = [
  'heart',
  'star',
  'fire',
  'bookmark',
  'sparkle',
] as const;

export type UserCustomListIcon = (typeof USER_CUSTOM_LIST_ICONS)[number];

export const MAX_USER_CUSTOM_LISTS = 5;

@Entity('user_custom_lists')
export class UserCustomList {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_user_custom_lists_user')
  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', default: 'heart' })
  icon: string;

  @Column({ type: 'boolean', name: 'is_public', default: false })
  isPublic: boolean;

  /** Set when the list first becomes public; cleared if privatized. Used for feed ranking. */
  @Column({ type: 'timestamptz', name: 'published_at', nullable: true })
  publishedAt: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;

  @ManyToOne(() => TelegramUser, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'telegram_user_id' })
  user: TelegramUser;

  @OneToMany(() => UserCustomListItem, (item) => item.list)
  items: UserCustomListItem[];
}
