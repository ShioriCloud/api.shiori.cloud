import {
  Column,
  CreateDateColumn,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { Anime } from './anime.entity';

export type AutomationStatus = 'disabled' | 'active' | 'paused' | 'manual';
export type AutomationTriggerMode = 'subtitle' | 'new_episode' | 'manual';

@Entity('anime_automation_configs')
export class AnimeAutomationConfig {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id', unique: true })
  animeId: string;

  @Column({ type: 'text', default: 'disabled' })
  status: AutomationStatus;

  /** subtitle | new_episode | manual — primary trigger */
  @Column({ type: 'text', name: 'trigger_mode', default: 'subtitle' })
  triggerMode: AutomationTriggerMode;

  @Column({ type: 'boolean', name: 'new_episode_trigger_enabled', default: false })
  newEpisodeTriggerEnabled: boolean;

  /** Inclusive start episode (null = no lower bound beyond exclusions) */
  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'start_episode', nullable: true })
  startEpisode: number | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'end_episode', nullable: true })
  endEpisode: number | null;

  /** JSON number[] of excluded episode numbers */
  @Column({ type: 'jsonb', name: 'excluded_episodes', default: () => "'[]'::jsonb" })
  excludedEpisodes: number[];

  /** JSON number[] of enabled season numbers; empty = all */
  @Column({ type: 'jsonb', name: 'enabled_seasons', default: () => "'[]'::jsonb" })
  enabledSeasons: number[];

  @Column({ type: 'text', name: 'processing_method', default: 'remux' })
  processingMethod: string;

  @Column({ type: 'text', name: 'last_error', nullable: true })
  lastError: string | null;

  @Column({ type: 'numeric', precision: 8, scale: 2, name: 'last_processed_episode', nullable: true })
  lastProcessedEpisode: number | null;

  @Column({ type: 'timestamptz', name: 'last_job_at', nullable: true })
  lastJobAt: Date | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
