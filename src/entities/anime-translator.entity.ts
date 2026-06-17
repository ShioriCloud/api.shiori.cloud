import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
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

  @OneToMany(() => AnimeTranslatorLink, (link) => link.translator)
  animeLinks: AnimeTranslatorLink[];
}
