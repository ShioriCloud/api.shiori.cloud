import { CreateDateColumn, Entity, PrimaryColumn } from 'typeorm';

@Entity('anime_comment_likes')
export class AnimeCommentLike {
  @PrimaryColumn({ type: 'uuid', name: 'comment_id' })
  commentId: string;

  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;
}
