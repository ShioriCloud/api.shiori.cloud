import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
  UserAnimeListEntry,
} from '../../entities';

export type AnimeGenreDto = { slug: string; name_en?: string; name_fa?: string };

export type AnimeCardDto = {
  id: string;
  title: string;
  title_romaji?: string | null;
  image: string;
  featuredImage?: string;
  description: string;
  format?: string;
  status: string;
  airing_status?: string;
  genres: AnimeGenreDto[];
  episodes_count?: number;
  studio?: string;
  season?: string;
  year?: number;
  startDate?: string;
  endDate?: string;
  isFeatured?: boolean;
  averageScore?: number;
  malScore?: number;
  imdbScore?: number;
  shioriScore?: number;
  anilist_id?: number;
  mal_id?: number;
  imdb_id?: string;
  favoriteCount?: number;
};

@Injectable()
export class AnimeCatalogService {
  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeGenre)
    private readonly genreRepo: Repository<AnimeGenre>,
    @InjectRepository(AnimeGenreLink)
    private readonly genreLinkRepo: Repository<AnimeGenreLink>,
    @InjectRepository(AnimeStudio)
    private readonly studioRepo: Repository<AnimeStudio>,
    @InjectRepository(AnimeEpisode)
    private readonly episodeRepo: Repository<AnimeEpisode>,
    @InjectRepository(AnimeSubtitle)
    private readonly subtitleRepo: Repository<AnimeSubtitle>,
    @InjectRepository(AnimeSubtitlePack)
    private readonly subtitlePackRepo: Repository<AnimeSubtitlePack>,
    @InjectRepository(AnimeTranslator)
    private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink)
    private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
    @InjectRepository(AnimeSeriesMember)
    private readonly seriesMemberRepo: Repository<AnimeSeriesMember>,
    @InjectRepository(UserAnimeListEntry)
    private readonly userListRepo: Repository<UserAnimeListEntry>,
  ) {}

  private num(value: string | number | null | undefined): number | undefined {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  private async loadGenresForAnimeIds(
    animeIds: string[],
  ): Promise<Map<string, AnimeGenreDto[]>> {
    const map = new Map<string, AnimeGenreDto[]>();
    if (animeIds.length === 0) return map;

    const links = await this.genreLinkRepo.find({
      where: { animeId: In(animeIds) },
      relations: { genre: true },
    });

    for (const link of links) {
      const list = map.get(link.animeId) ?? [];
      list.push({
        slug: link.genre.slug,
        name_en: link.genre.nameEn ?? undefined,
        name_fa: link.genre.nameFa ?? undefined,
      });
      map.set(link.animeId, list);
    }
    return map;
  }

  private toCard(
    anime: Anime,
    genres: AnimeGenreDto[],
    favoriteCount?: number,
  ): AnimeCardDto {
    return {
      id: anime.id,
      title: anime.title || 'بدون عنوان',
      title_romaji: anime.titleRomaji,
      image: anime.coverImage ?? '',
      featuredImage: anime.featuredImage ?? undefined,
      description: anime.synopsis ?? '',
      format: anime.format ?? undefined,
      status: anime.airingStatus ?? 'RELEASING',
      airing_status: anime.airingStatus ?? undefined,
      genres,
      episodes_count: anime.episodesCount ?? undefined,
      studio: anime.studio ?? undefined,
      season: anime.season ?? undefined,
      year: anime.year ?? undefined,
      startDate: anime.startDate ?? undefined,
      endDate: anime.endDate ?? undefined,
      isFeatured: anime.isFeatured,
      averageScore: this.num(anime.averageScore),
      malScore: this.num(anime.malScore),
      imdbScore: this.num(anime.imdbScore),
      shioriScore: this.num(anime.shioriScore),
      anilist_id: anime.anilistId ?? undefined,
      mal_id: anime.malId ?? undefined,
      imdb_id: anime.imdbId ?? undefined,
      favoriteCount,
    };
  }

  async listFeatured(limit = 10): Promise<AnimeCardDto[]> {
    const rows = await this.animeRepo.find({
      where: { isFeatured: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  async listPopular(limit = 20): Promise<AnimeCardDto[]> {
    const counts = await this.userListRepo
      .createQueryBuilder('list')
      .select('list.anime_id', 'animeId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('list.anime_id')
      .orderBy('count', 'DESC')
      .limit(limit)
      .getRawMany<{ animeId: string; count: string }>();

    if (counts.length === 0) {
      return this.listRecent(limit);
    }

    const ids = counts.map((c) => c.animeId);
    const rows = await this.animeRepo.find({ where: { id: In(ids) } });
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const genreMap = await this.loadGenresForAnimeIds(ids);

    return counts
      .map((c) => {
        const anime = rowMap.get(c.animeId);
        if (!anime) return null;
        return this.toCard(
          anime,
          genreMap.get(anime.id) ?? [],
          Number(c.count),
        );
      })
      .filter((x): x is AnimeCardDto => x != null);
  }

  async listRecent(limit = 20): Promise<AnimeCardDto[]> {
    const rows = await this.animeRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  async search(query: string, limit = 30): Promise<AnimeCardDto[]> {
    const q = query.trim();
    if (!q) return [];

    const rows = await this.animeRepo
      .createQueryBuilder('anime')
      .where(
        'anime.title ILIKE :q OR anime.title_romaji ILIKE :q OR anime.synopsis ILIKE :q',
        { q: `%${q}%` },
      )
      .orderBy('anime.created_at', 'DESC')
      .take(limit)
      .getMany();

    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  async getById(id: string) {
    const anime = await this.animeRepo.findOne({ where: { id } });
    if (!anime) throw new NotFoundException('Anime not found');

    const genreMap = await this.loadGenresForAnimeIds([id]);
    const episodes = await this.episodeRepo.find({
      where: { animeId: id },
      order: { episodeNumber: 'ASC' },
    });
    const subtitles = await this.subtitleRepo.find({
      where: { animeId: id },
      order: { episodeNumber: 'ASC' },
    });
    const subtitlePacks = await this.subtitlePackRepo.find({
      where: { animeId: id },
    });
    const translatorLinks = await this.translatorLinkRepo.find({
      where: { animeId: id },
      relations: { translator: true },
    });
    const seriesMember = await this.seriesMemberRepo.findOne({
      where: { animeId: id },
      relations: { series: true },
    });

    let series: {
      series_id: string;
      title: string;
      members: Array<{
        id: string;
        title: string;
        image: string;
        sort_order: number;
        label_fa: string | null;
      }>;
    } | null = null;

    if (seriesMember?.series) {
      const members = await this.seriesMemberRepo.find({
        where: { seriesId: seriesMember.seriesId },
        relations: { anime: true },
        order: { sortOrder: 'ASC' },
      });
      series = {
        series_id: seriesMember.seriesId,
        title: seriesMember.series.title,
        members: members.map((m) => ({
          id: m.animeId,
          title: m.anime?.title ?? '',
          image: m.anime?.coverImage ?? '',
          sort_order: m.sortOrder,
          label_fa: m.labelFa,
        })),
      };
    }

    const favoriteCount = await this.userListRepo.count({
      where: { animeId: id },
    });

    return {
      ...this.toCard(anime, genreMap.get(id) ?? [], favoriteCount),
      episode_pack_title: anime.episodePackTitle,
      episode_pack_link: anime.episodePackLink,
      prev_anime_id: anime.prevAnimeId,
      next_anime_id: anime.nextAnimeId,
      episodes: episodes.map((e) => ({
        id: e.id,
        episode_number: e.episodeNumber,
        title: e.title,
        download_link: e.downloadLink,
      })),
      subtitles: subtitles.map((s) => ({
        id: s.id,
        episode_number: s.episodeNumber,
        title: s.title,
        subtitle_link: s.subtitleLink,
      })),
      subtitle_packs: subtitlePacks.map((p) => ({
        id: p.id,
        title: p.title,
        subtitle_link: p.subtitleLink,
      })),
      translators: translatorLinks.map((l) => ({
        id: l.translator.id,
        slug: l.translator.slug,
        name: l.translator.name,
        role: l.role,
      })),
      series,
    };
  }

  async getByAnilistId(anilistId: number): Promise<string | null> {
    const anime = await this.animeRepo.findOne({ where: { anilistId } });
    return anime?.id ?? null;
  }

  async listGenres() {
    return this.genreRepo.find({ order: { slug: 'ASC' } });
  }

  async getStudioBySlug(slug: string) {
    const studio = await this.studioRepo.findOne({ where: { slug } });
    if (!studio) throw new NotFoundException('Studio not found');
    return studio;
  }

  async getTranslatorBySlug(slug: string) {
    const translator = await this.translatorRepo.findOne({ where: { slug } });
    if (!translator) throw new NotFoundException('Translator not found');

    const links = await this.translatorLinkRepo.find({
      where: { translatorId: translator.id },
      relations: { anime: true },
    });

    const genreMap = await this.loadGenresForAnimeIds(
      links.map((l) => l.animeId),
    );

    return {
      translator,
      anime: links.map((l) =>
        this.toCard(l.anime, genreMap.get(l.animeId) ?? []),
      ),
    };
  }
}
