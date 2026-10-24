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

export type AutomationJobState =
  | 'SUBTITLE_RECEIVED'
  | 'MATCHED'
  | 'ELIGIBLE'
  | 'SEARCHING'
  | 'AWAITING_SELECTION'
  | 'DOWNLOAD_QUEUED'
  | 'DOWNLOADING'
  | 'DOWNLOADED'
  | 'WAITING_FOR_SUBTITLE'
  | 'ENCODING'
  | 'MUXING'
  | 'VALIDATING'
  | 'READY_FOR_ARCHIVE'
  | 'AWAITING_MANUAL_ARCHIVE'
  | 'ARCHIVING'
  | 'LINKED'
  | 'DRAFT_QUEUED'
  | 'AWAITING_APPROVAL'
  | 'PUBLISHED'
  | 'NEEDS_REVIEW'
  | 'FAILED'
  | 'CANCELLED';

@Entity('automation_jobs')
@Index(['animeId', 'episodeNumber', 'state'])
@Index(['state', 'updatedAt'])
export class AutomationJob {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'idempotency_key', unique: true })
  idempotencyKey: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'episode_number' })
  episodeNumber: number;

  @Column({ type: 'int', name: 'season_number', nullable: true })
  seasonNumber: number | null;

  @Column({ type: 'text', default: 'SUBTITLE_RECEIVED' })
  state: AutomationJobState;

  @Column({ type: 'text', name: 'trigger_source', default: 'subtitle' })
  triggerSource: string;

  @Column({ type: 'uuid', name: 'subtitle_submission_id', nullable: true })
  subtitleSubmissionId: string | null;

  @Column({ type: 'text', name: 'selected_release_name', nullable: true })
  selectedReleaseName: string | null;

  @Column({ type: 'text', name: 'selected_magnet', nullable: true })
  selectedMagnet: string | null;

  @Column({ type: 'text', name: 'torrent_hash', nullable: true })
  torrentHash: string | null;

  @Column({ type: 'text', name: 'download_path', nullable: true })
  downloadPath: string | null;

  @Column({ type: 'text', name: 'output_path', nullable: true })
  outputPath: string | null;

  @Column({ type: 'text', name: 'output_file_name', nullable: true })
  outputFileName: string | null;

  @Column({ type: 'text', name: 'archive_file_key', nullable: true })
  archiveFileKey: string | null;

  @Column({ type: 'text', name: 'download_link', nullable: true })
  downloadLink: string | null;

  @Column({ type: 'uuid', name: 'draft_id', nullable: true })
  draftId: string | null;

  @Column({
    type: 'jsonb',
    name: 'release_candidates',
    default: () => "'[]'::jsonb",
  })
  releaseCandidates: unknown[];

  @Column({ type: 'jsonb', name: 'progress', default: () => "'{}'::jsonb" })
  progress: Record<string, unknown>;

  @Column({ type: 'text', name: 'error_message', nullable: true })
  errorMessage: string | null;

  @Column({ type: 'text', name: 'error_code', nullable: true })
  errorCode: string | null;

  @Column({ type: 'int', name: 'attempt_count', default: 0 })
  attemptCount: number;

  @Column({ type: 'timestamptz', name: 'claimed_at', nullable: true })
  claimedAt: Date | null;

  @Column({ type: 'text', name: 'claimed_by', nullable: true })
  claimedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
