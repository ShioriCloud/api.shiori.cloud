import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { AnimeGenreLink } from './anime-genre-link.entity';

@Entity('genres')
export class AnimeGenre {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text', name: 'name_en', nullable: true })
  nameEn: string | null;

  @Column({ type: 'text', name: 'name_fa', nullable: true })
  nameFa: string | null;

  @Column({ type: 'text', name: 'image_url', nullable: true })
  imageUrl: string | null;

  @OneToMany(() => AnimeGenreLink, (link) => link.genre)
  animeLinks: AnimeGenreLink[];
}
