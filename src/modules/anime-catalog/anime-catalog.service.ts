import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  findAnimeByIdOrSlug,
  requireAnimeId,
} from '../../common/anime-ref.util';
import {
  normalizeEpisodeVideoFileType,
  normalizeHardsubLanguage,
  normalizeVideoEncode,
  normalizeVideoFileType,
  normalizeVideoResolution,
} from '../../common/anime-media-meta.util';
import {
  Anime,
  AnimeEpisode,
  AnimeGenre,
  AnimeGenreLink,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeStudioLink,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
  BotFile,
  UserAnimeListEntry,
} from '../../entities';

export type AnimeGenreDto = {
  slug: string;
  name_en?: string;
  name_fa?: string;
};

export type AnimeSearchParams = {
  query?: string;
  year?: number | null;
  season?: string | null;
  genreSlug?: string | null;
  genreSlugs?: string[];
  format?: string | null;
  airingStatus?: string | null;
  hardsubLanguage?: 'fa' | 'en' | null;
  sortBy?: 'created_at' | 'popular' | 'title' | 'score';
  limit?: number;
  offset?: number;
};

export type AnimeSearchResult = {
  items: AnimeCardDto[];
  total: number;
  hasMore: boolean;
};

export type AnimeCardDto = {
  id: string;
  slug?: string | null;
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
  shioriScore?: number;
  anilist_id?: number;
  mal_id?: number;
  favoriteCount?: number;
  viewCount?: number;
  hardsub_language?: 'fa' | 'en';
  video_file_type?: 'softsub' | 'hardsub';
  video_resolution?: '480p' | '720p' | '1080p';
  video_encode?: 'x264' | 'x265' | 'x265_10bit' | 'bluray';
};

@Injectable()
export class AnimeCatalogService {
  private readonly logger = new Logger(AnimeCatalogService.name);

  /** In-memory airing schedule cache (shared across requests; Nest singleton). */
  private airingScheduleCache: {
    key: string;
    expiresAt: number;
    payload: {
      schedule: ReturnType<AnimeCatalogService['buildEmptyAiringSchedule']>;
      currentSeason: string;
      currentYear: number;
    };
  } | null = null;

  private readonly AIRING_SCHEDULE_TTL_MS = 2 * 60 * 60 * 1000;

  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeGenre)
    private readonly genreRepo: Repository<AnimeGenre>,
    @InjectRepository(AnimeGenreLink)
    private readonly genreLinkRepo: Repository<AnimeGenreLink>,
    @InjectRepository(AnimeStudio)
    private readonly studioRepo: Repository<AnimeStudio>,
    @InjectRepository(AnimeStudioLink)
    private readonly studioLinkRepo: Repository<AnimeStudioLink>,
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
    @InjectRepository(BotFile)
    private readonly botFileRepo: Repository<BotFile>,
  ) {}

  private num(value: string | number | null | undefined): number | undefined {
    if (value == null || value === '') return undefined;
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }

  /** Extract `files.key` from `t.me/...?start=get_<key>` or bare `get_<key>`. */
  private parseTelegramFileKeyFromLink(
    link: string | null | undefined,
  ): string | null {
    const raw = String(link ?? '').trim();
    if (!raw) return null;

    const fromUrl = raw.match(/[?&]start=get_([^&]+)/i)?.[1];
    if (fromUrl) {
      try {
        return decodeURIComponent(fromUrl).trim() || null;
      } catch {
        return fromUrl.trim() || null;
      }
    }

    const bare = raw.match(/^get_(.+)$/i)?.[1];
    if (!bare) return null;
    try {
      return decodeURIComponent(bare).trim() || null;
    } catch {
      return bare.trim() || null;
    }
  }

  /** AVG(files.file_size) for episode download links that resolve to bot files. */
  private async getAverageEpisodeSizeBytes(
    episodes: AnimeEpisode[],
  ): Promise<number | null> {
    const keys = [
      ...new Set(
        episodes
          .map((e) => this.parseTelegramFileKeyFromLink(e.downloadLink))
          .filter((k): k is string => Boolean(k)),
      ),
    ];
    if (keys.length === 0) return null;

    const raw = await this.botFileRepo
      .createQueryBuilder('f')
      .select('AVG(CAST(f.fileSize AS DOUBLE PRECISION))', 'avg')
      .where('f.key IN (:...keys)', { keys })
      .andWhere('f.fileSize IS NOT NULL')
      .andWhere('CAST(f.fileSize AS BIGINT) > 0')
      .getRawOne<{ avg: string | null }>();

    const avg = Number(raw?.avg);
    if (!Number.isFinite(avg) || avg <= 0) return null;
    return Math.round(avg);
  }

  /** Live average of user ratings (source of truth for shioriScore in API responses). */
  private async getLiveShioriScore(animeId: string): Promise<number | undefined> {
    const raw = await this.userListRepo.manager.query(
      `
      SELECT ROUND(AVG(user_rating)::numeric, 1) AS avg
      FROM user_anime_list
      WHERE anime_id = $1
        AND user_rating IS NOT NULL
      `,
      [animeId],
    );
    const avgRaw = Array.isArray(raw) ? raw[0]?.avg : null;
    if (avgRaw == null || avgRaw === '') return undefined;
    const n = Number(avgRaw);
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

  private toCard(anime: Anime, genres: AnimeGenreDto[]): AnimeCardDto {
    return {
      id: anime.id,
      slug: anime.slug,
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
      shioriScore: this.num(anime.shioriScore),
      anilist_id: anime.anilistId ?? undefined,
      mal_id: anime.malId ?? undefined,
      viewCount: Number(anime.viewCount) || 0,
      hardsub_language: normalizeHardsubLanguage(anime.hardsubLanguage),
      video_file_type: normalizeVideoFileType(anime.videoFileType),
      video_resolution: normalizeVideoResolution(anime.videoResolution),
      video_encode: normalizeVideoEncode(anime.videoEncode),
    };
  }

  async listAll(): Promise<AnimeCardDto[]> {
    const rows = await this.animeRepo.find({
      order: { createdAt: 'DESC' },
    });
    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  /** Lightweight cards for a set of anime ids (My List). Max 100. */
  async listByIds(ids: string[]): Promise<AnimeCardDto[]> {
    const unique = [...new Set(ids.map((id) => String(id).trim()).filter(Boolean))].slice(
      0,
      100,
    );
    if (unique.length === 0) return [];

    const rows = await this.animeRepo.find({ where: { id: In(unique) } });
    if (rows.length === 0) return [];

    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    const rowMap = new Map(rows.map((r) => [r.id, r]));

    return unique
      .map((id) => {
        const anime = rowMap.get(id);
        if (!anime) return null;
        return this.toCard(anime, genreMap.get(anime.id) ?? []);
      })
      .filter((x): x is AnimeCardDto => x != null);
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
    const rows = await this.animeRepo.find({
      order: { viewCount: 'DESC', createdAt: 'DESC' },
      take: limit,
    });
    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  async recordView(idOrSlug: string): Promise<{ viewCount: number }> {
    const animeId = await requireAnimeId(this.animeRepo, idOrSlug);
    // Only bump view_count — never touch updated_at / last_edited_at (admin list sort).
    const rows = await this.animeRepo.query(
      `UPDATE anime SET view_count = COALESCE(view_count, 0) + 1 WHERE id = $1 RETURNING view_count`,
      [animeId],
    );
    return { viewCount: Number(rows?.[0]?.view_count) || 0 };
  }

  async listRecent(limit = 20): Promise<AnimeCardDto[]> {
    const rows = await this.animeRepo.find({
      order: { createdAt: 'DESC' },
      take: limit,
    });
    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    return rows.map((row) => this.toCard(row, genreMap.get(row.id) ?? []));
  }

  async search(params: AnimeSearchParams): Promise<AnimeSearchResult> {
    const limit =
      Number.isFinite(params.limit) && (params.limit ?? 0) > 0
        ? params.limit!
        : 48;
    const offset =
      Number.isFinite(params.offset) && (params.offset ?? 0) >= 0
        ? params.offset!
        : 0;

    const genreSlugs = [
      ...new Set(
        [
          ...(params.genreSlugs ?? []).map((s) => String(s).trim().toLowerCase()),
          params.genreSlug
            ? String(params.genreSlug).trim().toLowerCase()
            : '',
        ].filter(Boolean),
      ),
    ];
    const season =
      params.season && String(params.season).trim()
        ? String(params.season).trim().toUpperCase()
        : '';
    const year =
      params.year !== null &&
      params.year !== undefined &&
      Number.isFinite(params.year)
        ? params.year
        : null;

    let qb = this.animeRepo.createQueryBuilder('anime');

    genreSlugs.forEach((slug, index) => {
      qb = qb
        .innerJoin('anime_genres', `ag_f_${index}`, `ag_f_${index}.anime_id = anime.id`)
        .innerJoin('genres', `g_f_${index}`, `g_f_${index}.id = ag_f_${index}.genre_id`)
        .andWhere(`g_f_${index}.slug = :genreSlug_${index}`, {
          [`genreSlug_${index}`]: slug,
        });
    });

    if (year !== null) {
      qb = qb.andWhere('anime.year = :year', { year });
    }

    if (season) {
      qb = qb.andWhere('anime.season = :season', { season });
    }

    const formatKey = params.format
      ? String(params.format).trim().toUpperCase()
      : '';
    if (formatKey) {
      if (formatKey === 'DONGHUA') {
        qb = qb.andWhere(`UPPER(anime.format) = 'ONA (CHINESE)'`);
      } else {
        qb = qb.andWhere('UPPER(anime.format) = :formatKey', { formatKey });
      }
    }

    const airingStatus = params.airingStatus
      ? String(params.airingStatus).trim().toUpperCase()
      : '';
    if (airingStatus) {
      qb = qb.andWhere('anime.airing_status = :airingStatusFilter', {
        airingStatusFilter: airingStatus,
      });
    }

    const hardsubLanguage = params.hardsubLanguage
      ? String(params.hardsubLanguage).trim().toLowerCase()
      : '';
    if (hardsubLanguage === 'fa' || hardsubLanguage === 'en') {
      qb = qb.andWhere('anime.hardsub_language = :hardsubLanguage', {
        hardsubLanguage,
      });
    }

    const tokens = String(params.query ?? '')
      .trim()
      .split(/\s+/)
      .map((t) => t.replace(/,/g, ' ').trim())
      .filter((t) => t.length > 0);

    for (let i = 0; i < tokens.length; i++) {
      qb = qb.andWhere(
        `(anime.title ILIKE :token${i} OR anime.title_romaji ILIKE :token${i})`,
        { [`token${i}`]: `%${tokens[i]}%` },
      );
    }

    const total = await qb.clone().select('anime.id').distinct(true).getCount();

    this.applySearchSort(qb, params.sortBy);
    const rows = await qb.skip(offset).take(limit).getMany();

    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    const items = rows.map((row) =>
      this.toCard(row, genreMap.get(row.id) ?? []),
    );

    return {
      items,
      total,
      hasMore: offset + items.length < total,
    };
  }

  private applySearchSort(
    qb: ReturnType<Repository<Anime>['createQueryBuilder']>,
    sortBy?: AnimeSearchParams['sortBy'],
  ) {
    switch (sortBy) {
      case 'popular':
        qb.orderBy('anime.viewCount', 'DESC').addOrderBy(
          'anime.createdAt',
          'DESC',
        );
        break;
      case 'title':
        qb.orderBy('anime.title', 'ASC').addOrderBy('anime.createdAt', 'DESC');
        break;
      case 'score':
        qb.orderBy(
          'COALESCE(anime.shioriScore, anime.averageScore, anime.malScore)',
          'DESC',
          'NULLS LAST',
        ).addOrderBy('anime.createdAt', 'DESC');
        break;
      case 'created_at':
      default:
        qb.orderBy('anime.createdAt', 'DESC');
    }
  }

  async getSimilar(
    idOrSlug: string,
    genreSlugs: string[],
    limit = 12,
  ): Promise<AnimeCardDto[]> {
    const animeId = await requireAnimeId(this.animeRepo, idOrSlug);
    const slugs = [
      ...new Set(
        genreSlugs.map((s) => String(s).trim().toLowerCase()).filter(Boolean),
      ),
    ];
    if (slugs.length === 0) return [];

    const genres = await this.genreRepo.find({ where: { slug: In(slugs) } });
    if (genres.length === 0) return [];

    const links = await this.genreLinkRepo.find({
      where: { genreId: In(genres.map((g) => g.id)) },
    });

    const counts = new Map<string, number>();
    for (const link of links) {
      if (link.animeId === animeId) continue;
      counts.set(link.animeId, (counts.get(link.animeId) ?? 0) + 1);
    }

    const topIds = [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, limit)
      .map(([id]) => id);

    if (topIds.length === 0) return [];

    const rows = await this.animeRepo.find({ where: { id: In(topIds) } });
    const rowMap = new Map(rows.map((r) => [r.id, r]));
    const genreMap = await this.loadGenresForAnimeIds(topIds);

    return topIds
      .map((id) => {
        const anime = rowMap.get(id);
        if (!anime) return null;
        return this.toCard(anime, genreMap.get(id) ?? []);
      })
      .filter((x): x is AnimeCardDto => x != null);
  }

  async searchLegacy(query: string, limit = 30): Promise<AnimeCardDto[]> {
    const result = await this.search({ query, limit, offset: 0 });
    return result.items;
  }

  async getById(idOrSlug: string) {
    const anime = await findAnimeByIdOrSlug(this.animeRepo, idOrSlug);
    if (!anime) throw new NotFoundException('Anime not found');

    const id = anime.id;
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
    const studioLinks = await this.studioLinkRepo.find({
      where: { animeId: id },
      relations: { studio: true },
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
          slug: m.anime?.slug ?? null,
          title: m.anime?.title ?? '',
          image: m.anime?.coverImage ?? '',
          sort_order: m.sortOrder,
          label_fa: m.labelFa,
        })),
      };
    }

    const liveShioriScore = await this.getLiveShioriScore(id);
    const averageEpisodeSizeBytes =
      await this.getAverageEpisodeSizeBytes(episodes);

    // next_airing is filled by the mini-app client when needed — do not block
    // catalog detail on AniList (TTFB / skeleton).
    const next_airing: { episode: number; airing_at: number } | null = null;

    return {
      ...this.toCard(anime, genreMap.get(id) ?? []),
      // Prefer live average so UI never depends on a stale/missing cached column.
      shioriScore: liveShioriScore ?? this.num(anime.shioriScore),
      next_airing,
      average_episode_size_bytes: averageEpisodeSizeBytes,
      episodes: episodes.map((e) => {
        const video_file_type = normalizeEpisodeVideoFileType(e.videoFileType);
        /**
         * Launch: expose download links (open mini-app UX).
         * Later (subscription gate): mask softsub/hardsub — only free keeps link;
         * paid downloads go through POST /subscriptions/episode-download/claim.
         *
         * const MASK_PAID_DOWNLOAD_LINKS = true;
         * const download_link =
         *   MASK_PAID_DOWNLOAD_LINKS && video_file_type !== 'free'
         *     ? null
         *     : e.downloadLink;
         */
        const download_link = e.downloadLink;
        return {
          id: e.id,
          episode_number: e.episodeNumber,
          title: e.title,
          download_link,
          video_file_type,
        };
      }),
      episode_pack_title: anime.episodePackTitle,
      /**
       * Launch: expose pack link.
       * Later: set episode_pack_link null + episode_pack_available true,
       * claim via POST /subscriptions/episode-pack/claim.
       */
      episode_pack_link: anime.episodePackLink,
      episode_pack_available: Boolean(anime.episodePackLink?.trim()),
      prev_anime_id: anime.prevAnimeId,
      next_anime_id: anime.nextAnimeId,
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
        id: l.id,
        anime_id: l.animeId,
        translator_id: l.translatorId,
        role: l.role,
        translator: {
          id: l.translator.id,
          slug: l.translator.slug,
          name: l.translator.name,
          avatar_url: l.translator.avatarUrl,
          cover_url: l.translator.coverUrl,
          bio: l.translator.bio,
          experience: l.translator.experience,
          is_active: l.translator.isActive,
        },
      })),
      studio_links: studioLinks.map((l) => ({
        slug: l.studio.slug,
        name: l.studio.name,
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

  async getGenreBySlug(slug: string) {
    const genre = await this.genreRepo.findOne({
      where: { slug: slug.trim().toLowerCase() },
    });
    if (!genre) throw new NotFoundException('Genre not found');
    return genre;
  }

  async resolveAnilistIdsBatch(
    anilistIds: number[],
  ): Promise<Record<string, string>> {
    const unique = [
      ...new Set(anilistIds.filter((id) => Number.isFinite(id) && id > 0)),
    ];
    if (unique.length === 0) return {};

    const rows = await this.animeRepo.find({
      where: { anilistId: In(unique) },
    });

    const result: Record<string, string> = {};
    for (const row of rows) {
      if (row.anilistId) result[String(row.anilistId)] = row.id;
    }
    return result;
  }

  async getStudioBySlug(slug: string) {
    const studio = await this.studioRepo.findOne({ where: { slug } });
    if (!studio) throw new NotFoundException('Studio not found');
    return studio;
  }

  async listAnimeByStudioSlug(slug: string): Promise<AnimeCardDto[]> {
    const studio = await this.studioRepo.findOne({ where: { slug } });
    if (!studio) throw new NotFoundException('Studio not found');

    const links = await this.studioLinkRepo.find({
      where: { studioId: studio.id },
      relations: { anime: true },
    });

    const animes = links
      .map((l) => l.anime)
      .filter((a): a is Anime => Boolean(a))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

    const genreMap = await this.loadGenresForAnimeIds(animes.map((a) => a.id));
    return animes.map((a) => this.toCard(a, genreMap.get(a.id) ?? []));
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

  async listFavoriteCounts(): Promise<Record<string, number>> {
    const rows = await this.userListRepo
      .createQueryBuilder('list')
      .select('list.anime_id', 'animeId')
      .addSelect('COUNT(*)', 'count')
      .groupBy('list.anime_id')
      .getRawMany<{ animeId: string; count: string }>();

    const result: Record<string, number> = {};
    for (const row of rows) {
      result[row.animeId] = Number(row.count) || 0;
    }
    return result;
  }

  async getFavoriteCount(idOrSlug: string): Promise<number> {
    const animeId = await requireAnimeId(this.animeRepo, idOrSlug);
    return this.userListRepo.count({ where: { animeId } });
  }

  async listAiringSchedule() {
    const emptySchedule = this.buildEmptyAiringSchedule();
    const { season: currentSeason, year: currentYear } =
      this.getCurrentAiringSeasonInTehran();
    const cacheKey = `${currentSeason}:${currentYear}`;
    const now = Date.now();

    const freshCache =
      this.airingScheduleCache &&
      this.airingScheduleCache.key === cacheKey &&
      this.airingScheduleCache.expiresAt > now
        ? this.airingScheduleCache
        : null;
    if (freshCache) {
      return freshCache.payload;
    }

    const staleCache =
      this.airingScheduleCache && this.airingScheduleCache.key === cacheKey
        ? this.airingScheduleCache
        : null;

    try {
      const mediaList = await this.fetchAnilistReleasingMedia(
        currentSeason,
        currentYear,
      );
      const schedule = { ...emptySchedule };

      for (const m of mediaList) {
        const allowedFormats = new Set(['TV', 'ONA', 'OVA', 'SPECIAL']);
        const format =
          typeof m?.format === 'string' ? m.format.trim().toUpperCase() : '';
        if (!allowedFormats.has(format)) continue;

        const ep = m?.nextAiringEpisode as
          | { airingAt?: number; episode?: number }
          | undefined;
        if (!ep || typeof ep.airingAt !== 'number') continue;

        const airingAtMs = ep.airingAt * 1000;
        if (!Number.isFinite(airingAtMs)) continue;

        const d = new Date(airingAtMs);
        const day = this.toPersianWeekday(d);
        if (!schedule[day]) continue;

        const titleObj = m?.title as
          | { english?: string; romaji?: string; native?: string }
          | undefined;
        const title =
          (typeof titleObj?.english === 'string' && titleObj.english.trim()) ||
          (typeof titleObj?.romaji === 'string' && titleObj.romaji.trim()) ||
          (typeof titleObj?.native === 'string' && titleObj.native.trim()) ||
          'بدون عنوان';

        const time = new Intl.DateTimeFormat('fa-IR', {
          hour: '2-digit',
          minute: '2-digit',
          timeZone: 'Asia/Tehran',
        }).format(d);

        const coverImage = m?.coverImage as { large?: string } | undefined;
        const genresRaw = Array.isArray(m?.genres) ? m.genres : [];

        schedule[day].push({
          id: Number(m.id),
          title,
          time,
          episode: String(ep.episode ?? ''),
          image: coverImage?.large ?? '',
          genres: genresRaw
            .filter((g): g is string => typeof g === 'string' && g.trim().length > 0)
            .map((g) => ({ slug: g.trim().toLowerCase(), name_en: g })),
          localId: null,
        });
      }

      for (const day of Object.keys(schedule)) {
        schedule[day].sort((a, b) => String(a.time).localeCompare(String(b.time)));
      }

      const anilistIds = Object.values(schedule)
        .flat()
        .map((item) => item.id)
        .filter((id) => Number.isFinite(id) && id > 0);

      if (anilistIds.length > 0) {
        const rows = await this.animeRepo.find({
          where: { anilistId: In(anilistIds) },
          select: { id: true, anilistId: true },
        });
        const localByAnilist = new Map(
          rows
            .filter((row) => row.anilistId != null)
            .map((row) => [Number(row.anilistId), row.id]),
        );

        for (const day of Object.keys(schedule)) {
          schedule[day] = schedule[day].map((item) => ({
            ...item,
            localId: localByAnilist.get(item.id) ?? null,
          }));
        }
      }

      const itemCount = Object.values(schedule).reduce(
        (sum, list) => sum + list.length,
        0,
      );
      const payload = { schedule, currentSeason, currentYear };
      if (itemCount > 0) {
        this.airingScheduleCache = {
          key: cacheKey,
          expiresAt: now + this.AIRING_SCHEDULE_TTL_MS,
          payload,
        };
      }
      return payload;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Airing schedule upstream failed: ${message}`);
      if (staleCache) {
        this.logger.warn('Serving stale airing schedule cache after upstream failure');
        return staleCache.payload;
      }
      return { schedule: emptySchedule, currentSeason, currentYear, degraded: true };
    }
  }

  private buildEmptyAiringSchedule() {
    return {
      شنبه: [],
      یکشنبه: [],
      دوشنبه: [],
      سه‌شنبه: [],
      چهارشنبه: [],
      پنج‌شنبه: [],
      جمعه: [],
    } as Record<
      string,
      Array<{
        id: number;
        title: string;
        time: string;
        episode: string;
        image: string;
        genres: { slug: string; name_en?: string }[];
        localId: string | null;
      }>
    >;
  }

  private getCurrentAiringSeason(): 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' {
    return this.getCurrentAiringSeasonInTehran().season;
  }

  private getCurrentAiringSeasonInTehran(): {
    season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
    year: number;
  } {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(new Date());
    const year = Number(parts.find((p) => p.type === 'year')?.value);
    const month = Number(parts.find((p) => p.type === 'month')?.value);
    const y = Number.isFinite(year) ? year : new Date().getFullYear();
    const m = Number.isFinite(month) ? month : new Date().getMonth() + 1;
    if (m >= 1 && m <= 3) return { season: 'WINTER', year: y };
    if (m >= 4 && m <= 6) return { season: 'SPRING', year: y };
    if (m >= 7 && m <= 9) return { season: 'SUMMER', year: y };
    return { season: 'FALL', year: y };
  }

  /** Weekday label in Persian, using Asia/Tehran calendar day (not server local TZ). */
  private toPersianWeekday(d: Date): string {
    const weekday = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      weekday: 'short',
    }).format(d);
    const dayMap: Record<string, string> = {
      Sun: 'یکشنبه',
      Mon: 'دوشنبه',
      Tue: 'سه‌شنبه',
      Wed: 'چهارشنبه',
      Thu: 'پنج‌شنبه',
      Fri: 'جمعه',
      Sat: 'شنبه',
    };
    return dayMap[weekday] ?? '';
  }

  private async fetchAnilistReleasingMedia(
    season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL',
    seasonYear: number,
  ): Promise<Array<Record<string, unknown>>> {
    const query = `
      query ($page: Int, $perPage: Int, $season: MediaSeason, $seasonYear: Int) {
        Page(page: $page, perPage: $perPage) {
          media(
            season: $season
            seasonYear: $seasonYear
            status: RELEASING
            type: ANIME
            sort: POPULARITY_DESC
          ) {
            id
            format
            title { romaji english native }
            coverImage { large }
            genres
            nextAiringEpisode { airingAt episode }
          }
        }
      }
    `;

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 12_000);

    try {
      const res = await fetch('https://graphql.anilist.co', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify({
          query,
          variables: { page: 1, perPage: 50, season, seasonYear },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`AniList request failed: ${res.status} ${text}`);
      }

      const json = (await res.json()) as {
        errors?: Array<{ message?: string }>;
        data?: { Page?: { media?: Array<Record<string, unknown>> } };
      };
      if (json?.errors?.length) {
        throw new Error(json.errors?.[0]?.message || 'AniList query error');
      }

      return json?.data?.Page?.media ?? [];
    } finally {
      clearTimeout(timeout);
    }
  }
}
