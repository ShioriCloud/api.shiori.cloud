import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnimeTranslatorLink } from './anime-translator-link.entity';

@Entity('translators')
export class AnimeTranslator {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text' })
  name: string;

  @Column({ type: 'text', name: 'avatar_url', nullable: true })
  avatarUrl: string | null;

  @Column({ type: 'text', name: 'cover_url', nullable: true })
  coverUrl: string | null;

  @Column({ type: 'text', nullable: true })
  bio: string | null;

  @Column({ type: 'text', nullable: true })
  experience: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  /**
   * Linked mini-app / Telegram account. When set, badge + translation
   * activity merge into that user's social profile automatically.
   */
  @Index('idx_translators_telegram_user_id', { unique: true })
  @Column({ type: 'bigint', name: 'telegram_user_id', nullable: true })
  telegramUserId: string | null;

  @OneToMany(() => AnimeTranslatorLink, (link) => link.translator)
  animeLinks: AnimeTranslatorLink[];
}
