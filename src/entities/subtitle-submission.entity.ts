import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Anime } from './anime.entity';

@Entity('subtitle_submissions')
@Index(['telegramMessageId', 'telegramChatId'], { unique: true })
export class SubtitleSubmission {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id', nullable: true })
  animeId: string | null;

  @Column({
    type: 'numeric',
    precision: 8,
    scale: 2,
    name: 'episode_number',
    nullable: true,
  })
  episodeNumber: number | null;

  @Column({ type: 'text', name: 'filename_title', nullable: true })
  filenameTitle: string | null;

  @Column({ type: 'text', name: 'original_file_name' })
  originalFileName: string;

  @Column({ type: 'text', name: 'telegram_file_id', nullable: true })
  telegramFileId: string | null;

  @Column({ type: 'bigint', name: 'telegram_message_id' })
  telegramMessageId: string;

  @Column({ type: 'text', name: 'telegram_chat_id' })
  telegramChatId: string;

  @Column({ type: 'text', name: 'content_hash', nullable: true })
  contentHash: string | null;

  @Column({ type: 'int', name: 'revision', default: 1 })
  revision: number;

  @Column({ type: 'text', name: 'stored_path', nullable: true })
  storedPath: string | null;

  @Column({
    type: 'jsonb',
    name: 'extracted_meta',
    default: () => "'{}'::jsonb",
  })
  extractedMeta: Record<string, unknown>;

  @Column({ type: 'text', default: 'received' })
  status: string;

  @Column({ type: 'text', name: 'match_note', nullable: true })
  matchNote: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime | null;
}
