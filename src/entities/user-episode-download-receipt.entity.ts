import { Column, Entity, Index, PrimaryColumn } from 'typeorm';

/** One row per user + episode for successful download claims (idempotent). */
@Entity('user_episode_download_receipts')
@Index('idx_user_episode_download_receipts_user', ['telegramUserId'])
export class UserEpisodeDownloadReceipt {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @PrimaryColumn({ type: 'uuid', name: 'episode_id' })
  episodeId: string;

  @Column({ type: 'text', name: 'source', default: 'free_download' })
  source: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
