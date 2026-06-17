import { Column, Entity, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { Anime } from './anime.entity';
import { AnimeTranslator } from './anime-translator.entity';

@Entity('translator_anime')
export class AnimeTranslatorLink {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'uuid', name: 'translator_id' })
  translatorId: string;

  @Column({ type: 'text', nullable: true })
  role: string | null;

  @ManyToOne(() => Anime, (anime) => anime.translatorLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;

  @ManyToOne(() => AnimeTranslator, (translator) => translator.animeLinks, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'translator_id' })
  translator: AnimeTranslator;
}
