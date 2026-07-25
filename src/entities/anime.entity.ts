import {
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { AnimeEpisode } from './anime-episode.entity';
import { AnimeGenreLink } from './anime-genre-link.entity';
import { AnimeStudioLink } from './anime-studio-link.entity';
import { AnimeSubtitle } from './anime-subtitle.entity';
import { AnimeSubtitlePack } from './anime-subtitle-pack.entity';
import { AnimeTranslatorLink } from './anime-translator-link.entity';
import { TelegramUser } from './telegram-user.entity';

@Entity('anime')
export class Anime {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', name: 'title_romaji', nullable: true })
  titleRomaji: string | null;

  @Column({ type: 'text', nullable: true, unique: true })
  slug: string | null;

  @Column({ type: 'text', name: 'cover_image', nullable: true })
  coverImage: string | null;

  @Column({ type: 'text', name: 'featured_image', nullable: true })
  featuredImage: string | null;

  @Column({ type: 'text', nullable: true })
  synopsis: string | null;

  @Column({ type: 'text', nullable: true })
  format: string | null;

  @Column({ type: 'text', name: 'airing_status', nullable: true })
  airingStatus: string | null;

  @Column({
    type: 'numeric',
    precision: 5,
    scale: 2,
    name: 'average_score',
    nullable: true,
  })
  averageScore: string | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 2,
    name: 'mal_score',
    nullable: true,
  })
  malScore: string | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 2,
    name: 'imdb_score',
    nullable: true,
  })
  imdbScore: string | null;

  @Column({
    type: 'numeric',
    precision: 4,
    scale: 1,
    name: 'shiori_score',
    nullable: true,
  })
  shioriScore: string | null;

  /** Cumulative detail-page views (popularity signal). */
  @Column({ type: 'int', name: 'view_count', default: 0 })
  viewCount: number;

  @Column({ type: 'int', name: 'anilist_id', nullable: true })
  anilistId: number | null;

  @Column({ type: 'int', name: 'mal_id', nullable: true })
  malId: number | null;

  @Column({ type: 'text', name: 'imdb_id', nullable: true })
  imdbId: string | null;

  @Column({ type: 'int', name: 'episodes_count', nullable: true })
  episodesCount: number | null;

  @Column({ type: 'text', nullable: true })
  studio: string | null;

  @Column({ type: 'text', nullable: true })
  season: string | null;

  @Column({ type: 'int', nullable: true })
  year: number | null;

  @Column({ type: 'date', name: 'start_date', nullable: true })
  startDate: string | null;

  @Column({ type: 'date', name: 'end_date', nullable: true })
  endDate: string | null;

  @Column({ type: 'boolean', name: 'is_featured', default: false })
  isFeatured: boolean;

  @Column({ type: 'text', name: 'episode_pack_title', nullable: true })
  episodePackTitle: string | null;

  @Column({ type: 'text', name: 'episode_pack_link', nullable: true })
  episodePackLink: string | null;

  /** Hardsub badge language for public UI: `fa` | `en` */
  @Column({ type: 'text', name: 'hardsub_language', default: 'fa' })
  hardsubLanguage: string;

  /** Release file kind: `softsub` | `hardsub` */
  @Column({ type: 'text', name: 'video_file_type', default: 'softsub' })
  videoFileType: string;

  /** Available resolution: `480p` | `720p` | `1080p` */
  @Column({ type: 'text', name: 'video_resolution', default: '1080p' })
  videoResolution: string;

  /** Encode label: `x264` | `x265` | `x265_10bit` | `bluray` */
  @Column({ type: 'text', name: 'video_encode', default: 'x265_10bit' })
  videoEncode: string;

  @Column({ type: 'uuid', name: 'prev_anime_id', nullable: true })
  prevAnimeId: string | null;

  @Column({ type: 'uuid', name: 'next_anime_id', nullable: true })
  nextAnimeId: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;

  @Column({ type: 'bigint', name: 'last_edited_by', nullable: true })
  lastEditedById: string | null;

  @ManyToOne(() => TelegramUser, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'last_edited_by' })
  lastEditedBy: TelegramUser | null;

  @ManyToOne(() => Anime, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'prev_anime_id' })
  prevAnime: Anime | null;

  @ManyToOne(() => Anime, { nullable: true, onDelete: 'SET NULL' })
  @JoinColumn({ name: 'next_anime_id' })
  nextAnime: Anime | null;

  @OneToMany(() => AnimeGenreLink, (link) => link.anime)
  genreLinks: AnimeGenreLink[];

  @OneToMany(() => AnimeStudioLink, (link) => link.anime)
  studioLinks: AnimeStudioLink[];

  @OneToMany(() => AnimeEpisode, (episode) => episode.anime)
  episodes: AnimeEpisode[];

  @OneToMany(() => AnimeSubtitle, (subtitle) => subtitle.anime)
  subtitles: AnimeSubtitle[];

  @OneToMany(() => AnimeSubtitlePack, (pack) => pack.anime)
  subtitlePacks: AnimeSubtitlePack[];

  @OneToMany(() => AnimeTranslatorLink, (link) => link.anime)
  translatorLinks: AnimeTranslatorLink[];
}
