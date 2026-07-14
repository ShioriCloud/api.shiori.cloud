import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity('file_download_events')
@Index('idx_file_download_events_downloaded_at', ['downloadedAt'])
@Index('idx_file_download_events_file_key_downloaded_at', ['fileKey', 'downloadedAt'])
export class BotFileDownloadEvent {
  @PrimaryGeneratedColumn({ type: 'bigint' })
  id: string;

  @Column({ type: 'text', name: 'file_key' })
  fileKey: string;

  @Column({ type: 'timestamptz', name: 'downloaded_at', default: () => 'now()' })
  downloadedAt: Date;
}
