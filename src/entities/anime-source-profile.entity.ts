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

@Entity('anime_source_profiles')
export class AnimeSourceProfile {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id', unique: true })
  animeId: string;

  @Column({ type: 'text', name: 'canonical_title', nullable: true })
  canonicalTitle: string | null;

  /** Alternative titles used in release filenames */
  @Column({ type: 'jsonb', name: 'alt_titles', default: () => "'[]'::jsonb" })
  altTitles: string[];

  @Column({ type: 'text', name: 'streaming_platform', nullable: true })
  streamingPlatform: string | null;

  @Column({
    type: 'jsonb',
    name: 'preferred_groups',
    default: () => "'[]'::jsonb",
  })
  preferredGroups: string[];

  @Column({
    type: 'jsonb',
    name: 'fallback_groups',
    default: () => "'[]'::jsonb",
  })
  fallbackGroups: string[];

  @Column({ type: 'text', name: 'preferred_resolution', default: '1080p' })
  preferredResolution: string;

  @Column({ type: 'text', name: 'preferred_codec', default: 'hevc' })
  preferredCodec: string;

  @Column({ type: 'int', name: 'preferred_bit_depth', nullable: true })
  preferredBitDepth: number | null;

  @Column({ type: 'bigint', name: 'max_file_size_bytes', nullable: true })
  maxFileSizeBytes: string | null;

  @Column({
    type: 'jsonb',
    name: 'allowed_providers',
    default: () => "'[]'::jsonb",
  })
  allowedProviders: string[];

  @Column({
    type: 'jsonb',
    name: 'search_patterns',
    default: () => "'[]'::jsonb",
  })
  searchPatterns: string[];

  @Column({
    type: 'jsonb',
    name: 'excluded_keywords',
    default: () => "'[]'::jsonb",
  })
  excludedKeywords: string[];

  /** auto | prefer_group | always_manual */
  @Column({ type: 'text', name: 'selection_mode', default: 'auto' })
  selectionMode: string;

  @Column({ type: 'boolean', name: 'custom_encoding_enabled', default: false })
  customEncodingEnabled: boolean;

  @Column({ type: 'text', name: 'handbrake_preset', nullable: true })
  handbrakePreset: string | null;

  @Column({ type: 'boolean', name: 'subtitle_default', default: true })
  subtitleDefault: boolean;

  @Column({ type: 'boolean', name: 'subtitle_forced', default: false })
  subtitleForced: boolean;

  @Column({ type: 'jsonb', name: 'extra', default: () => "'{}'::jsonb" })
  extra: Record<string, unknown>;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
