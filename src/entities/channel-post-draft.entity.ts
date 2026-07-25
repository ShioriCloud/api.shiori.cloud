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

export type ChannelPostDraftStatus = 'pending' | 'published' | 'rejected';

@Entity('channel_post_drafts')
export class ChannelPostDraft {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'int', name: 'episode_number' })
  episodeNumber: number;

  @Column({ type: 'text', name: 'proposed_caption' })
  proposedCaption: string;

  @Column({ type: 'text', name: 'cover_file_id', nullable: true })
  coverFileId: string | null;

  @Column({ type: 'text', default: 'pending' })
  status: ChannelPostDraftStatus;

  @Column({ type: 'bigint', name: 'admin_preview_message_id', nullable: true })
  adminPreviewMessageId: string | null;

  @Column({ type: 'bigint', name: 'admin_preview_chat_id', nullable: true })
  adminPreviewChatId: string | null;

  @Column({ type: 'bigint', name: 'published_message_id', nullable: true })
  publishedMessageId: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
