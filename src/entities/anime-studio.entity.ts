import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AnimeStudioLink } from './anime-studio-link.entity';

@Entity('studios')
export class AnimeStudio {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text' })
  name: string;

  @OneToMany(() => AnimeStudioLink, (link) => link.studio)
  animeLinks: AnimeStudioLink[];
}
