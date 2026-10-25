import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type AnimeCommentModerationStatus = 'pending' | 'approved' | 'rejected';

@Entity('anime_comments')
@Index(['animeId', 'parentId', 'createdAt'])
@Index(['telegramUserId', 'createdAt'])
export class AnimeComment {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'uuid', name: 'parent_id', nullable: true })
  parentId: string | null;

  /** When set, this reply is directed at another comment in the same thread. */
  @Column({ type: 'uuid', name: 'reply_to_comment_id', nullable: true })
  replyToCommentId: string | null;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'boolean', name: 'is_deleted', default: false })
  isDeleted: boolean;

  @Column({
    type: 'varchar',
    length: 20,
    name: 'moderation_status',
    default: 'pending',
  })
  moderationStatus: AnimeCommentModerationStatus;

  @Column({ type: 'timestamptz', name: 'moderated_at', nullable: true })
  moderatedAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
