import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  findAnimeByIdOrSlug,
  requireAnimeId,
} from '../../common/anime-ref.util';
import { isUuid } from '../../common/uuid.util';
import { normalizeSlug } from '../../common/slug.util';
import {
  SHIORI_WEEKDAYS,
  resolveShioriAiringPlan,
  resolveShioriNextAiring,
} from '../../common/shiori-next-airing.util';
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
  TelegramUser,
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
  sortBy?: 'created_at' | 'last_episode_at' | 'popular' | 'title' | 'score';
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
  /** Highest published episode number (home new-episodes rail). */
  latest_episode_number?: number;
};

/** Weekly grid: episodic Shiori titles. MOVIE (and other formats) stay out. */
const SHIORI_WEEKLY_SCHEDULE_FORMATS = [
  'TV',
  'TV_SHORT',
  'ONA',
  'ONA (CHINESE)',
  'OVA',
  'SPECIAL',
] as const;

const isShioriWeeklyScheduleFormat = (format: unknown): boolean => {
  const key = String(format ?? '')
    .trim()
    .toUpperCase();
  return (SHIORI_WEEKLY_SCHEDULE_FORMATS as readonly string[]).includes(key);
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

  private readonly AIRING_SCHEDULE_TTL_MS = 30 * 60 * 1000;
  /** Keep items that aired very recently so "on air now" still appears. */
  private readonly AIRING_GRACE_MS = 30 * 60 * 1000;

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
    @InjectRepository(TelegramUser)
    private readonly telegramUserRepo: Repository<TelegramUser>,
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

  /** Lightweight cards for a set of anime ids or slugs (My List / resolve). Max 100. */
  async listByIds(ids: string[]): Promise<AnimeCardDto[]> {
    const unique = [
      ...new Set(ids.map((id) => String(id).trim()).filter(Boolean)),
    ].slice(0, 100);
    if (unique.length === 0) return [];

    const uuidIds = unique.filter((id) => isUuid(id));
    const slugIds = [
      ...new Set(
        unique
          .filter((id) => !isUuid(id))
          .map((id) => normalizeSlug(id) || id)
          .filter(Boolean),
      ),
    ];

    const [byId, bySlug] = await Promise.all([
      uuidIds.length > 0
        ? this.animeRepo.find({ where: { id: In(uuidIds) } })
        : Promise.resolve([] as Anime[]),
      slugIds.length > 0
        ? this.animeRepo.find({ where: { slug: In(slugIds) } })
        : Promise.resolve([] as Anime[]),
    ]);

    const rows = [...byId, ...bySlug];
    if (rows.length === 0) return [];

    const genreMap = await this.loadGenresForAnimeIds(rows.map((r) => r.id));
    const byIdMap = new Map(rows.map((r) => [r.id, r]));
    const bySlugMap = new Map(
      rows.filter((r) => r.slug).map((r) => [String(r.slug).toLowerCase(), r]),
    );

    return unique
      .map((key) => {
        const anime = isUuid(key)
          ? byIdMap.get(key)
          : bySlugMap.get(String(normalizeSlug(key) || key).toLowerCase());
        if (!anime) return null;
        return this.toCard(anime, genreMap.get(anime.id) ?? []);
      })
      .filter((x): x is AnimeCardDto => x != null);
  }

  async listFeatured(limit = 10): Promise<AnimeCardDto[]> {
    const rows = await this.animeRepo.find({
      where: { isFeatured: true },
      order: { createdAt: 'DESC' },
      ...(limit > 0 ? { take: limit } : {}),
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

  /**
   * Anime that received an episode upload in the last 7 days.
   * One card per title, ordered by lastEpisodeAt DESC (any airing status).
   */
  async listNewEpisodes(limit = 20): Promise<AnimeCardDto[]> {
    const take =
      Number.isFinite(limit) && limit > 0
        ? Math.min(Math.floor(limit), 50)
        : 20;
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const rows = await this.animeRepo
      .createQueryBuilder('anime')
      .where('anime.lastEpisodeAt IS NOT NULL')
      .andWhere('anime.lastEpisodeAt >= :since', { since })
      .orderBy('anime.lastEpisodeAt', 'DESC')
      .addOrderBy('anime.createdAt', 'DESC')
      .take(take)
      .getMany();

    if (rows.length === 0) return [];

    const ids = rows.map((r) => r.id);
    const genreMap = await this.loadGenresForAnimeIds(ids);

    const episodeMaxRows = await this.episodeRepo
      .createQueryBuilder('ep')
      .select('ep.anime_id', 'animeId')
      .addSelect('MAX(ep.episode_number)', 'maxEpisode')
      .where('ep.anime_id IN (:...ids)', { ids })
      .groupBy('ep.anime_id')
      .getRawMany<{
        animeId: string;
        maxEpisode: string | null;
      }>();

    const maxByAnime = new Map<string, number>();
    for (const row of episodeMaxRows) {
      const n = Number(row.maxEpisode);
      if (Number.isFinite(n) && n > 0) maxByAnime.set(String(row.animeId), n);
    }

    return rows.map((row) => {
      const card = this.toCard(row, genreMap.get(row.id) ?? []);
      const latest = maxByAnime.get(row.id);
      if (latest != null) card.latest_episode_number = latest;
      return card;
    });
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
          ...(params.genreSlugs ?? []).map((s) =>
            String(s).trim().toLowerCase(),
          ),
          params.genreSlug ? String(params.genreSlug).trim().toLowerCase() : '',
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
        .innerJoin(
          'anime_genres',
          `ag_f_${index}`,
          `ag_f_${index}.anime_id = anime.id`,
        )
        .innerJoin(
          'genres',
          `g_f_${index}`,
          `g_f_${index}.id = ag_f_${index}.genre_id`,
        )
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
      case 'last_episode_at':
        qb.orderBy('anime.lastEpisodeAt', 'DESC', 'NULLS LAST').addOrderBy(
          'anime.createdAt',
          'DESC',
        );
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

    const [
      genreMap,
      episodes,
      subtitles,
      subtitlePacks,
      translatorLinks,
      studioLinks,
      seriesMember,
    ] = await Promise.all([
      this.loadGenresForAnimeIds([id]),
      this.episodeRepo.find({
        where: { animeId: id },
        order: { episodeNumber: 'ASC' },
      }),
      this.subtitleRepo.find({
        where: { animeId: id },
        order: { episodeNumber: 'ASC' },
      }),
      this.subtitlePackRepo.find({
        where: { animeId: id },
      }),
      this.translatorLinkRepo.find({
        where: { animeId: id },
        relations: { translator: true },
      }),
      this.studioLinkRepo.find({
        where: { animeId: id },
        relations: { studio: true },
      }),
      this.seriesMemberRepo.findOne({
        where: { animeId: id },
        relations: { series: true },
      }),
    ]);

    // Run series + AVG size in parallel after episodes are known (AVG needs link keys).
    const [series, averageEpisodeSizeBytes] = await Promise.all([
      (async () => {
        if (!seriesMember?.series) return null;
        const members = await this.seriesMemberRepo.find({
          where: { seriesId: seriesMember.seriesId },
          relations: { anime: true },
          order: { sortOrder: 'ASC' },
        });
        return {
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
      })(),
      this.getAverageEpisodeSizeBytes(episodes),
    ]);

    let maxPublishedEpisode: number | null = null;
    for (const episode of episodes) {
      const n = Number(episode.episodeNumber);
      if (Number.isFinite(n) && n > (maxPublishedEpisode ?? 0)) {
        maxPublishedEpisode = n;
      }
    }

    return {
      ...this.toCard(anime, genreMap.get(id) ?? []),
      shioriScore: this.num(anime.shioriScore),
      next_airing: resolveShioriNextAiring({
        airingStatus: anime.airingStatus,
        airingWeekday: anime.airingWeekday,
        airingTime: anime.airingTime,
        nextAiringDate: anime.nextAiringDate,
        startDate: anime.startDate,
        maxPublishedEpisode,
        episodesCount: anime.episodesCount,
      }),
      average_episode_size_bytes: averageEpisodeSizeBytes,
      episodes: episodes.map((e) => {
        const video_file_type = normalizeEpisodeVideoFileType(e.videoFileType);
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
      translators: await Promise.all(
        translatorLinks.map(async (l) => {
          const linkedTelegramUserId = await this.resolveLinkedTelegramUserId(
            l.translator,
          );
          return {
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
              telegram_user_id: l.translator.telegramUserId,
              linked_telegram_user_id: linkedTelegramUserId,
            },
          };
        }),
      ),
      studio_links: studioLinks.map((l) => ({
        slug: l.studio.slug,
        name: l.studio.name,
      })),
      series,
    };
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

  /** Explicit telegram_user_id on translator, or Telegram username matching slug. */
  private async resolveLinkedTelegramUserId(
    translator: AnimeTranslator,
  ): Promise<string | null> {
    if (translator.telegramUserId) {
      return String(translator.telegramUserId);
    }
    const handle = String(translator.slug ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    if (!handle) return null;
    const user = await this.telegramUserRepo
      .createQueryBuilder('u')
      .where('LOWER(u.username) = :handle', { handle })
      .getOne();
    return user ? String(user.telegramUserId) : null;
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

    const linkedTelegramUserId =
      await this.resolveLinkedTelegramUserId(translator);

    return {
      translator,
      linkedTelegramUserId,
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

  /**
   * Catalog-only weekly schedule: RELEASING and upcoming (NOT_YET_RELEASED)
   * titles with airing_weekday set. Episodic formats only (TV / ONA / donghua /
   * OVA / specials). Movies stay out. Independent of AniList availability.
   */
  async listShioriAiringSchedule() {
    const emptySchedule = this.buildEmptyAiringSchedule();
    const { season: currentSeason, year: currentYear } =
      this.getCurrentAiringSeasonInTehran();

    const rows = await this.animeRepo
      .createQueryBuilder('anime')
      .where('anime.airing_status IN (:...statuses)', {
        statuses: ['RELEASING', 'NOT_YET_RELEASED'],
      })
      .andWhere('anime.airing_weekday IS NOT NULL')
      .andWhere("TRIM(anime.airing_weekday) <> ''")
      .andWhere('UPPER(TRIM(anime.format)) IN (:...weeklyFormats)', {
        weeklyFormats: [...SHIORI_WEEKLY_SCHEDULE_FORMATS],
      })
      .orderBy('anime.airing_time', 'ASC', 'NULLS LAST')
      .addOrderBy('anime.title', 'ASC')
      .getMany();

    if (rows.length === 0) {
      return { schedule: emptySchedule, currentSeason, currentYear };
    }

    const ids = rows.map((row) => row.id);
    const genreMap = await this.loadGenresForAnimeIds(ids);

    // Calendar progression when start_date is set; max episode floors "next"
    // and remains the full fallback for titles without start_date.
    const episodeMaxRows = await this.episodeRepo
      .createQueryBuilder('ep')
      .select('ep.anime_id', 'animeId')
      .addSelect('MAX(ep.episode_number)', 'maxEpisode')
      .where('ep.anime_id IN (:...ids)', { ids })
      .groupBy('ep.anime_id')
      .getRawMany<{
        animeId: string;
        maxEpisode: string | null;
      }>();

    const maxByAnime = new Map<string, number>();
    for (const row of episodeMaxRows) {
      const n = Number(row.maxEpisode);
      if (Number.isFinite(n) && n > 0) maxByAnime.set(String(row.animeId), n);
    }

    const schedule = { ...emptySchedule };
    const weekdaySet = new Set<string>(SHIORI_WEEKDAYS);

    for (const anime of rows) {
      if (!isShioriWeeklyScheduleFormat(anime.format)) continue;
      const maxEp = maxByAnime.get(anime.id);
      const plan = resolveShioriAiringPlan({
        airingStatus: anime.airingStatus,
        airingWeekday: anime.airingWeekday,
        airingTime: anime.airingTime,
        nextAiringDate: anime.nextAiringDate,
        startDate: anime.startDate,
        maxPublishedEpisode: maxEp ?? null,
        episodesCount: anime.episodesCount,
      });
      if (!plan || !weekdaySet.has(plan.weekday) || !schedule[plan.weekday]) {
        continue;
      }

      const timeRaw = String(anime.airingTime ?? '').trim();
      const displayTime = timeRaw ? this.formatAiringTimeFa(timeRaw) : '';

      schedule[plan.weekday].push({
        id:
          anime.anilistId && anime.anilistId > 0
            ? anime.anilistId
            : this.stableNumericId(anime.id),
        title: anime.title || 'بدون عنوان',
        time: displayTime,
        episode: String(plan.episode),
        image: anime.coverImage || anime.featuredImage || '',
        genres: (genreMap.get(anime.id) ?? []).map((g) => ({
          slug: g.slug,
          name_en: g.name_en,
        })),
        localId: anime.id,
        airing_at: plan.airing_at,
      });
    }

    for (const day of Object.keys(schedule)) {
      schedule[day].sort((a, b) =>
        String(a.time).localeCompare(String(b.time), 'fa'),
      );
    }

    return { schedule, currentSeason, currentYear };
  }

  private formatAiringTimeFa(hhmm: string): string {
    const match = String(hhmm)
      .trim()
      .match(/^(\d{1,2}):(\d{2})$/);
    if (!match) return hhmm;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (!Number.isFinite(hour) || !Number.isFinite(minute)) return hhmm;
    const persianDigits = ['۰', '۱', '۲', '۳', '۴', '۵', '۶', '۷', '۸', '۹'];
    const toFa = (n: number, width = 2) =>
      String(n)
        .padStart(width, '0')
        .replace(/[0-9]/g, (d) => persianDigits[Number(d)] ?? d);
    return `${toFa(hour)}:${toFa(minute)}`;
  }

  private stableNumericId(uuid: string): number {
    const hex = String(uuid).replace(/-/g, '').slice(0, 8);
    const n = Number.parseInt(hex, 16);
    return Number.isFinite(n) && n > 0 ? n : 1;
  }

  async listAiringSchedule() {
    const emptySchedule = this.buildEmptyAiringSchedule();
    const { season: currentSeason, year: currentYear } =
      this.getCurrentAiringSeasonInTehran();
    // v2: upcoming-only schedule (skips stale nextAiringEpisode with past airingAt)
    const cacheKey = `v2:${currentSeason}:${currentYear}`;
    const now = Date.now();

    const freshCache =
      this.airingScheduleCache &&
      this.airingScheduleCache.key === cacheKey &&
      this.airingScheduleCache.expiresAt > now
        ? this.airingScheduleCache
        : null;
    if (freshCache) {
      return this.prunePastAiringEntries(freshCache.payload, now);
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
      const nowSec = Math.floor(now / 1000);
      const graceSec = Math.floor(this.AIRING_GRACE_MS / 1000);

      for (const m of mediaList) {
        if (!isShioriWeeklyScheduleFormat(m?.format)) continue;

        const ep = this.resolveUpcomingAiring(m, nowSec, graceSec);
        if (!ep) continue;

        const airingAtMs = ep.airingAt * 1000;
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
            .filter(
              (g): g is string => typeof g === 'string' && g.trim().length > 0,
            )
            .map((g) => ({ slug: g.trim().toLowerCase(), name_en: g })),
          localId: null,
          airing_at: ep.airingAt,
        });
      }

      for (const day of Object.keys(schedule)) {
        schedule[day].sort((a, b) =>
          String(a.time).localeCompare(String(b.time)),
        );
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
        this.logger.warn(
          'Serving stale airing schedule cache after upstream failure',
        );
        return this.prunePastAiringEntries(staleCache.payload, now);
      }
      return {
        schedule: emptySchedule,
        currentSeason,
        currentYear,
        degraded: true,
      };
    }
  }

  /**
   * Prefer live airingSchedule(notYetAired) over cached nextAiringEpisode.
   * Drop entries whose airingAt is already in the past (AniList lag).
   */
  private resolveUpcomingAiring(
    media: Record<string, unknown>,
    nowSec: number,
    graceSec: number,
  ): { airingAt: number; episode: number } | null {
    const scheduleNodes = (
      media?.airingSchedule as
        | { nodes?: Array<{ airingAt?: number; episode?: number }> }
        | undefined
    )?.nodes;
    const fromSchedule = Array.isArray(scheduleNodes) ? scheduleNodes[0] : null;
    const fromNext = media?.nextAiringEpisode as
      | { airingAt?: number; episode?: number }
      | undefined;

    const candidates = [fromSchedule, fromNext];
    for (const candidate of candidates) {
      if (!candidate || typeof candidate.airingAt !== 'number') continue;
      const airingAt = Number(candidate.airingAt);
      const episode = Number(candidate.episode);
      if (!Number.isFinite(airingAt) || airingAt <= 0) continue;
      if (airingAt + graceSec < nowSec) continue;
      if (!Number.isFinite(episode) || episode <= 0) continue;
      return { airingAt, episode };
    }
    return null;
  }

  private prunePastAiringEntries<
    T extends {
      schedule: Record<string, Array<{ airing_at?: number }>>;
      currentSeason: string;
      currentYear: number;
    },
  >(payload: T, nowMs = Date.now()): T {
    const cutoffSec = Math.floor((nowMs - this.AIRING_GRACE_MS) / 1000);
    const schedule: Record<string, Array<{ airing_at?: number }>> = {
      ...payload.schedule,
    };
    for (const day of Object.keys(schedule)) {
      schedule[day] = (schedule[day] ?? []).filter((item) => {
        if (item.airing_at == null) return true;
        return Number(item.airing_at) >= cutoffSec;
      });
    }
    return { ...payload, schedule };
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
        airing_at?: number;
      }>
    >;
  }

  private getCurrentAiringSeason(): 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL' {
    return this.getCurrentAiringSeasonInTehran().season;
  }

  /**
   * Current anime-industry season for labels / AniList queries.
   * Season boundaries follow the Jalali calendar in Asia/Tehran
   * (Mehr–Azar = FALL), not Gregorian Oct–Dec.
   * `year` stays Gregorian so labels stay «پاییز ۲۰۲۶» and catalog filters match.
   */
  private getCurrentAiringSeasonInTehran(): {
    season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
    year: number;
  } {
    const now = new Date();
    const jalaliParts = new Intl.DateTimeFormat('en-US-u-ca-persian', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);
    const gregorianParts = new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      year: 'numeric',
      month: 'numeric',
    }).formatToParts(now);

    const jalaliMonth = Number(
      jalaliParts.find((p) => p.type === 'month')?.value,
    );
    const gYear = Number(gregorianParts.find((p) => p.type === 'year')?.value);
    const gMonth = Number(
      gregorianParts.find((p) => p.type === 'month')?.value,
    );

    const jm = Number.isFinite(jalaliMonth) ? jalaliMonth : 1;
    const gy = Number.isFinite(gYear) ? gYear : new Date().getFullYear();
    const gm = Number.isFinite(gMonth) ? gMonth : new Date().getMonth() + 1;

    let season: 'WINTER' | 'SPRING' | 'SUMMER' | 'FALL';
    if (jm >= 1 && jm <= 3) season = 'SPRING';
    else if (jm >= 4 && jm <= 6) season = 'SUMMER';
    else if (jm >= 7 && jm <= 9) season = 'FALL';
    else season = 'WINTER';

    // AniList/catalog winter year is the January year of that winter.
    const year = season === 'WINTER' && gm === 12 ? gy + 1 : gy;

    return { season, year };
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
            airingSchedule(notYetAired: true, perPage: 1) {
              nodes { airingAt episode }
            }
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
