import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import { normalizeSlug } from '../../common/slug.util';
import { findAnimeByIdOrSlug } from '../../common/anime-ref.util';
import {
  fetchMalAnimeById,
  JikanClientError,
  searchMalAnime,
  type MalMappedMedia,
} from '../../common/jikan.client';
import { normalizeExternalId } from '../../common/external-score.util';
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
  AnimeSeries,
  AnimeSeriesMember,
  AnimeStudio,
  AnimeStudioLink,
  AnimeSubtitle,
  AnimeSubtitlePack,
  AnimeTranslator,
  AnimeTranslatorLink,
  UserAnimeListEntry,
  UserCustomListItem,
  UserNotification,
} from '../../entities';
import { NotificationsAdminService } from '../notifications-admin/notifications-admin.service';
import { ChannelDraftsService } from '../bot/channel-drafts.service';

type Payload = Record<string, unknown>;

type CatalogAdminListParams = {
  search?: string;
  page?: number;
  limit?: number;
  sortBy?: string;
  sortOrder?: 'ASC' | 'DESC';
};

@Injectable()
export class AnimeAdminService {
  private readonly logger = new Logger(AnimeAdminService.name);

  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeEpisode) private readonly episodeRepo: Repository<AnimeEpisode>,
    @InjectRepository(AnimeGenre) private readonly genreRepo: Repository<AnimeGenre>,
    @InjectRepository(AnimeGenreLink) private readonly genreLinkRepo: Repository<AnimeGenreLink>,
    @InjectRepository(AnimeStudio) private readonly studioRepo: Repository<AnimeStudio>,
    @InjectRepository(AnimeStudioLink) private readonly studioLinkRepo: Repository<AnimeStudioLink>,
    @InjectRepository(AnimeSubtitle) private readonly subtitleRepo: Repository<AnimeSubtitle>,
    @InjectRepository(AnimeSubtitlePack) private readonly subtitlePackRepo: Repository<AnimeSubtitlePack>,
    @InjectRepository(AnimeSeries) private readonly seriesRepo: Repository<AnimeSeries>,
    @InjectRepository(AnimeSeriesMember) private readonly seriesMemberRepo: Repository<AnimeSeriesMember>,
    @InjectRepository(AnimeTranslator) private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink) private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
    @InjectRepository(UserAnimeListEntry) private readonly userListRepo: Repository<UserAnimeListEntry>,
    @InjectRepository(UserNotification) private readonly userNotificationRepo: Repository<UserNotification>,
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly notificationsAdminService: NotificationsAdminService,
    private readonly channelDraftsService: ChannelDraftsService,
  ) {}

  private pick<T>(body: Payload, snake: string, camel: string): T | undefined {
    if (body[snake] !== undefined) return body[snake] as T;
    if (body[camel] !== undefined) return body[camel] as T;
    return undefined;
  }

  private numOrNull(v: unknown): number | null {
    if (typeof v === 'number' && Number.isFinite(v)) return v;
    if (v == null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  private static readonly AIRING_WEEKDAYS = [
    'شنبه',
    'یکشنبه',
    'دوشنبه',
    'سه‌شنبه',
    'چهارشنبه',
    'پنج‌شنبه',
    'جمعه',
  ] as const;

  private normalizeAiringWeekday(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (
      !(AnimeAdminService.AIRING_WEEKDAYS as readonly string[]).includes(trimmed)
    ) {
      throw new BadRequestException('invalid airing_weekday');
    }
    return trimmed;
  }

  private normalizeAiringTime(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    const match = trimmed.match(/^(\d{1,2}):(\d{2})$/);
    if (!match) throw new BadRequestException('invalid airing_time (use HH:mm)');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
      throw new BadRequestException('invalid airing_time (use HH:mm)');
    }
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
  }

  private normalizeNextAiringDate(
    value: string | null | undefined,
  ): string | null | undefined {
    if (value === undefined) return undefined;
    if (value == null) return null;
    const trimmed = String(value).trim();
    if (!trimmed) return null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      throw new BadRequestException('invalid next_airing_date (use YYYY-MM-DD)');
    }
    return trimmed;
  }

  private toGenre(g: AnimeGenre) {
    return {
      id: g.id,
      slug: g.slug,
      name_en: g.nameEn,
      name_fa: g.nameFa,
      image_url: g.imageUrl,
    };
  }

  private toStudio(s: AnimeStudio & { _animeCount?: number }) {
    return {
      id: s.id,
      slug: s.slug,
      name: s.name,
      anime_count: s._animeCount ?? 0,
    };
  }

  private toTranslator(t: AnimeTranslator & { _animeCount?: number; _episodeCount?: number }) {
    return {
      id: t.id,
      slug: t.slug,
      name: t.name,
      avatar_url: t.avatarUrl,
      cover_url: t.coverUrl,
      bio: t.bio,
      experience: t.experience,
      is_active: t.isActive,
      anime_count: t._animeCount ?? 0,
      episode_count: t._episodeCount ?? 0,
    };
  }

  private toAnimeCard(anime: Anime, genres: AnimeGenre[] = []) {
    return {
      id: anime.id,
      slug: anime.slug,
      title: anime.title,
      title_romaji: anime.titleRomaji,
      image: anime.coverImage ?? '',
      featuredImage: anime.featuredImage ?? '',
      description: anime.synopsis ?? '',
      format: anime.format ?? undefined,
      status: anime.airingStatus ?? '',
      airing_status: anime.airingStatus ?? undefined,
      genres: genres.map((g) => ({
        slug: g.slug,
        name_en: g.nameEn ?? undefined,
        name_fa: g.nameFa ?? undefined,
      })),
      episodes_count: anime.episodesCount ?? undefined,
      studio: anime.studio ?? undefined,
      season: anime.season ?? undefined,
      year: anime.year ?? undefined,
      startDate: anime.startDate ?? undefined,
      endDate: anime.endDate ?? undefined,
      isFeatured: anime.isFeatured,
      averageScore: this.numOrNull(anime.averageScore) ?? undefined,
      malScore: this.numOrNull(anime.malScore) ?? undefined,
      anilist_id: anime.anilistId ?? undefined,
      mal_id: anime.malId ?? undefined,
    };
  }

  private toAnimeAdminRow(anime: Anime) {
    const editor = anime.lastEditedBy;
    return {
      id: anime.id,
      title: anime.title,
      title_romaji: anime.titleRomaji,
      slug: anime.slug,
      synopsis: anime.synopsis,
      format: anime.format,
      season: anime.season,
      year: anime.year,
      anilist_id: anime.anilistId,
      mal_id: anime.malId,
      mal_score: this.numOrNull(anime.malScore),
      featured_image: anime.featuredImage,
      cover_image: anime.coverImage,
      is_featured: anime.isFeatured,
      airing_status: anime.airingStatus,
      airing_weekday: anime.airingWeekday,
      airing_time: anime.airingTime,
      next_airing_date: anime.nextAiringDate,
      average_score: this.numOrNull(anime.averageScore),
      episodes_count: anime.episodesCount,
      studio: anime.studio,
      start_date: anime.startDate,
      end_date: anime.endDate,
      episode_pack_title: anime.episodePackTitle,
      episode_pack_link: anime.episodePackLink,
      hardsub_language: normalizeHardsubLanguage(anime.hardsubLanguage),
      video_file_type: normalizeVideoFileType(anime.videoFileType),
      video_resolution: normalizeVideoResolution(anime.videoResolution),
      video_encode: normalizeVideoEncode(anime.videoEncode),
      has_channel_template: Boolean(
        anime.channelCoverFileId && anime.channelCaptionHtml,
      ),
      updated_at: anime.updatedAt?.toISOString?.() ?? null,
      last_edited_at: anime.lastEditedAt?.toISOString?.() ?? null,
      last_edited_by: anime.lastEditedById ? Number(anime.lastEditedById) : null,
      last_editor: editor
        ? {
            first_name: editor.firstName ?? null,
            last_name: editor.lastName ?? null,
            email: editor.email ?? null,
            username: editor.username ?? null,
          }
        : null,
      prev_anime_id: anime.prevAnimeId,
      next_anime_id: anime.nextAnimeId,
    };
  }

  private markAdminEdited(anime: Anime, editorId?: string) {
    const now = new Date();
    anime.updatedAt = now;
    anime.lastEditedAt = now;
    if (editorId) anime.lastEditedById = editorId;
  }

  private applyAnimeFields(anime: Anime, body: Payload) {
    const assign = <K extends keyof Anime>(key: K, val: Anime[K] | undefined) => {
      if (val !== undefined) anime[key] = val;
    };

    assign('title', this.pick<string>(body, 'title', 'title'));
    assign('titleRomaji', this.pick<string | null>(body, 'title_romaji', 'titleRomaji'));

    const slugRaw = this.pick<string | null>(body, 'slug', 'slug');
    if (slugRaw !== undefined) {
      const normalized = slugRaw ? normalizeSlug(slugRaw) : null;
      if (slugRaw && !normalized) {
        throw new BadRequestException('invalid slug');
      }
      assign('slug', normalized);
    }

    assign('coverImage', this.pick<string | null>(body, 'cover_image', 'coverImage'));
    assign('featuredImage', this.pick<string | null>(body, 'featured_image', 'featuredImage'));
    assign('synopsis', this.pick<string | null>(body, 'synopsis', 'synopsis'));
    assign('format', this.pick<string | null>(body, 'format', 'format'));
    assign('airingStatus', this.pick<string | null>(body, 'airing_status', 'airingStatus'));
    assign(
      'airingWeekday',
      this.normalizeAiringWeekday(
        this.pick<string | null>(body, 'airing_weekday', 'airingWeekday'),
      ),
    );
    assign(
      'airingTime',
      this.normalizeAiringTime(this.pick<string | null>(body, 'airing_time', 'airingTime')),
    );
    assign(
      'nextAiringDate',
      this.normalizeNextAiringDate(
        this.pick<string | null>(body, 'next_airing_date', 'nextAiringDate'),
      ),
    );
    assign('season', this.pick<string | null>(body, 'season', 'season'));
    assign('year', this.pick<number | null>(body, 'year', 'year'));
    assign('episodesCount', this.pick<number | null>(body, 'episodes_count', 'episodesCount'));
    assign('studio', this.pick<string | null>(body, 'studio', 'studio'));
    assign('isFeatured', this.pick<boolean>(body, 'is_featured', 'isFeatured'));
    assign('anilistId', this.pick<number | null>(body, 'anilist_id', 'anilistId'));
    assign('malId', this.pick<number | null>(body, 'mal_id', 'malId'));
    assign('startDate', this.pick<string | null>(body, 'start_date', 'startDate'));
    assign('endDate', this.pick<string | null>(body, 'end_date', 'endDate'));
    assign('episodePackTitle', this.pick<string | null>(body, 'episode_pack_title', 'episodePackTitle'));
    assign('episodePackLink', this.pick<string | null>(body, 'episode_pack_link', 'episodePackLink'));
    assign('prevAnimeId', this.pick<string | null>(body, 'prev_anime_id', 'prevAnimeId'));
    assign('nextAnimeId', this.pick<string | null>(body, 'next_anime_id', 'nextAnimeId'));

    const hardsubLanguage = this.pick<string | null>(body, 'hardsub_language', 'hardsubLanguage');
    if (hardsubLanguage !== undefined) {
      anime.hardsubLanguage = normalizeHardsubLanguage(hardsubLanguage);
    }

    const videoFileType = this.pick<string | null>(body, 'video_file_type', 'videoFileType');
    if (videoFileType !== undefined) {
      anime.videoFileType = normalizeVideoFileType(videoFileType);
    }

    const videoResolution = this.pick<string | null>(body, 'video_resolution', 'videoResolution');
    if (videoResolution !== undefined) {
      anime.videoResolution = normalizeVideoResolution(videoResolution);
    }

    const videoEncode = this.pick<string | null>(body, 'video_encode', 'videoEncode');
    if (videoEncode !== undefined) {
      anime.videoEncode = normalizeVideoEncode(videoEncode);
    }

    const malScore = this.pick<number | string | null>(body, 'mal_score', 'malScore');
    if (malScore !== undefined) anime.malScore = malScore == null ? null : String(malScore);
    const averageScore = this.pick<number | string | null>(body, 'average_score', 'averageScore');
    if (averageScore !== undefined) anime.averageScore = averageScore == null ? null : String(averageScore);
    const shioriScore = this.pick<number | string | null>(body, 'shiori_score', 'shioriScore');
    if (shioriScore !== undefined) anime.shioriScore = shioriScore == null ? null : String(shioriScore);

    return anime;
  }

  private async assertAnimeSlugAvailable(
    slug: string | null | undefined,
    excludeAnimeId?: string,
  ): Promise<void> {
    if (!slug) return;

    const existing = await this.animeRepo.findOne({
      where: { slug },
      select: { id: true, slug: true },
    });

    if (existing && existing.id !== excludeAnimeId) {
      throw new BadRequestException('slug already exists');
    }
  }

  async checkAnimeSlugAvailability(
    slugInput: string,
    excludeAnimeId?: string,
  ): Promise<{ available: boolean; slug: string; message: string }> {
    const slug = normalizeSlug(slugInput);
    if (!slug) {
      return {
        available: false,
        slug: '',
        message: 'slug is required',
      };
    }

    const existing = await this.animeRepo.findOne({
      where: { slug },
      select: { id: true, slug: true },
    });

    if (!existing || (excludeAnimeId && existing.id === excludeAnimeId)) {
      return {
        available: true,
        slug,
        message: 'slug is available',
      };
    }

    return {
      available: false,
      slug,
      message: 'slug already exists',
    };
  }

  private async loadGenresByAnimeIds(animeIds: string[]): Promise<Map<string, AnimeGenre[]>> {
    const map = new Map<string, AnimeGenre[]>();
    if (animeIds.length === 0) return map;
    const links = await this.genreLinkRepo.find({
      where: { animeId: In(animeIds) },
      relations: { genre: true },
    });
    for (const link of links) {
      const list = map.get(link.animeId) ?? [];
      if (link.genre) list.push(link.genre);
      map.set(link.animeId, list);
    }
    return map;
  }

  private async replaceGenreSlugs(animeId: string, slugs: string[]) {
    await this.genreLinkRepo.delete({ animeId });
    if (slugs.length === 0) return;
    const genres = await this.genreRepo.find({ where: { slug: In(slugs) } });
    const links = genres.map((g) => this.genreLinkRepo.create({ animeId, genreId: g.id }));
    if (links.length > 0) await this.genreLinkRepo.save(links);
  }

  private async replaceStudioSlugs(animeId: string, slugs: string[]) {
    await this.studioLinkRepo.delete({ animeId });
    if (slugs.length === 0) return;
    const studios = await this.studioRepo.find({ where: { slug: In(slugs) } });
    const links = studios.map((s) => this.studioLinkRepo.create({ animeId, studioId: s.id }));
    if (links.length > 0) await this.studioLinkRepo.save(links);
  }

  private async requireAnime(idOrSlug: string) {
    const anime = await findAnimeByIdOrSlug(this.animeRepo, idOrSlug);
    if (!anime) throw new NotFoundException('Anime not found');
    const full = await this.animeRepo.findOne({
      where: { id: anime.id },
      relations: { lastEditedBy: true },
    });
    if (!full) throw new NotFoundException('Anime not found');
    return full;
  }

  async getAnimeIdsWithEpisodes() {
    const rows = await this.episodeRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.anime_id', 'animeId')
      .getRawMany<{ animeId: string }>();
    return rows.map((r) => r.animeId);
  }

  async listAnime(params?: {
    search?: string;
    page?: number;
    limit?: number;
    filter?: 'all' | 'has-episodes' | 'no-episodes' | 'featured';
    year?: number;
    season?: string;
    sortBy?: 'updated_at' | 'created_at' | 'title' | 'year_desc' | 'year_asc';
  }) {
    const page = Math.max(1, params?.page ?? 1);
    const limit = Math.min(5000, Math.max(1, params?.limit ?? 50));
    const qb = this.animeRepo.createQueryBuilder('a');
    if (params?.search?.trim()) {
      const q = `%${params.search.trim()}%`;
      qb.andWhere(
        '(a.title ILIKE :q OR a.title_romaji ILIKE :q OR a.slug ILIKE :q)',
        { q },
      );
    }
    const filter = params?.filter ?? 'all';
    if (filter === 'featured') {
      qb.andWhere('a.is_featured = true');
    } else if (filter === 'has-episodes') {
      qb.andWhere('EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id)');
    } else if (filter === 'no-episodes') {
      qb.andWhere('NOT EXISTS (SELECT 1 FROM episodes e WHERE e.anime_id = a.id)');
    }
    if (Number.isFinite(params?.year) && Number(params?.year) > 0) {
      qb.andWhere('a.year = :year', { year: Number(params?.year) });
    }
    if (params?.season?.trim() && params.season !== 'all') {
      qb.andWhere('UPPER(a.season) = :season', { season: params.season.trim().toUpperCase() });
    }
    switch (params?.sortBy ?? 'updated_at') {
      case 'created_at':
        qb.orderBy('a.createdAt', 'DESC').addOrderBy('a.lastEditedAt', 'DESC', 'NULLS LAST');
        break;
      case 'title':
        qb.orderBy('LOWER(a.title)', 'ASC').addOrderBy('a.lastEditedAt', 'DESC', 'NULLS LAST');
        break;
      case 'year_asc':
        qb
          .orderBy('a.year', 'ASC', 'NULLS LAST')
          .addOrderBy('LOWER(a.title)', 'ASC')
          .addOrderBy('a.lastEditedAt', 'DESC', 'NULLS LAST');
        break;
      case 'year_desc':
        qb
          .orderBy('a.year', 'DESC', 'NULLS LAST')
          .addOrderBy('LOWER(a.title)', 'ASC')
          .addOrderBy('a.lastEditedAt', 'DESC', 'NULLS LAST');
        break;
      case 'updated_at':
      default:
        // Admin "آخرین ویرایش" — ignore mini-app view bumps on updated_at.
        qb
          .orderBy('a.lastEditedAt', 'DESC', 'NULLS LAST')
          .addOrderBy('a.createdAt', 'DESC');
        break;
    }
    const [rows, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    const genreMap = await this.loadGenresByAnimeIds(rows.map((r) => r.id));
    const hasEpisodeIds = await this.loadAnimeIdsWithEpisodes(rows.map((r) => r.id));
    return {
      items: rows.map((row) => ({
        ...this.toAnimeCard(row, genreMap.get(row.id) ?? []),
        has_episodes: hasEpisodeIds.has(row.id),
      })),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getAnimeListStats() {
    const total = await this.animeRepo.count();
    const featured = await this.animeRepo.count({ where: { isFeatured: true } });
    const withEpisodesRaw = await this.episodeRepo
      .createQueryBuilder('e')
      .select('COUNT(DISTINCT e.anime_id)', 'count')
      .getRawOne<{ count: string }>();
    const withEpisodes = Number(withEpisodesRaw?.count ?? 0);
    const yearRows = await this.animeRepo
      .createQueryBuilder('a')
      .select('DISTINCT a.year', 'year')
      .where('a.year IS NOT NULL')
      .orderBy('a.year', 'DESC')
      .getRawMany<{ year: string | number }>();
    const years = yearRows
      .map((row) => Math.trunc(Number(row.year)))
      .filter((year) => Number.isFinite(year) && year > 0);
    return {
      total,
      featured,
      withEpisodes,
      withoutEpisodes: Math.max(0, total - withEpisodes),
      years,
    };
  }

  private async loadAnimeIdsWithEpisodes(animeIds: string[]): Promise<Set<string>> {
    if (animeIds.length === 0) return new Set();
    const rows = await this.episodeRepo
      .createQueryBuilder('e')
      .select('DISTINCT e.anime_id', 'animeId')
      .where('e.anime_id IN (:...animeIds)', { animeIds })
      .getRawMany<{ animeId: string }>();
    return new Set(rows.map((r) => r.animeId));
  }

  async getAnimeAdmin(idOrSlug: string) {
    const anime = await this.requireAnime(idOrSlug);
    return this.toAnimeAdminRow(anime);
  }

  private throwMalUnavailable(err: unknown): never {
    const message =
      err instanceof JikanClientError
        ? err.message
        : err instanceof Error
          ? err.message
          : 'MyAnimeList request failed';
    this.logger.warn(`MAL/Jikan request failed: ${message}`);
    throw new ServiceUnavailableException(
      message.includes('429') || String(err).includes('429')
        ? 'MyAnimeList موقتاً شلوغ است؛ کمی بعد دوباره تلاش کنید'
        : 'ارتباط با MyAnimeList برقرار نشد',
    );
  }

  private uniqueNorm(value: string): string {
    return value.trim().toLowerCase();
  }

  private matchLocalGenreSlugs(
    names: string[],
    genres: AnimeGenre[],
  ): string[] {
    const slugs: string[] = [];
    for (const name of names) {
      const key = this.uniqueNorm(name);
      const slugKey = normalizeSlug(name);
      const match = genres.find((genre) => {
        const en = this.uniqueNorm(genre.nameEn ?? '');
        const fa = this.uniqueNorm(genre.nameFa ?? '');
        const slug = this.uniqueNorm(genre.slug ?? '');
        return Boolean(key) && (en === key || fa === key || slug === slugKey || slug === key);
      });
      if (match?.slug) slugs.push(match.slug);
    }
    return [...new Set(slugs)];
  }

  private matchLocalStudioSlugs(
    names: string[],
    studios: AnimeStudio[],
  ): { slugs: string[]; displayName: string | null } {
    const slugs: string[] = [];
    let displayName: string | null = null;
    for (const name of names) {
      const key = this.uniqueNorm(name);
      const slugKey = normalizeSlug(name);
      const match = studios.find((studio) => {
        const studioName = this.uniqueNorm(studio.name ?? '');
        const slug = this.uniqueNorm(studio.slug ?? '');
        return Boolean(key) && (studioName === key || slug === slugKey || slug === key);
      });
      if (match?.slug) {
        slugs.push(match.slug);
        if (!displayName) displayName = match.name;
      }
    }
    return {
      slugs: [...new Set(slugs)],
      displayName: displayName ?? names[0] ?? null,
    };
  }

  private async uniqueImportSlug(base: string, externalId: number, prefix: string): Promise<string> {
    const fallback = `${prefix}-${externalId}`;
    const primary = normalizeSlug(base) || fallback;
    const existing = await this.animeRepo.findOne({
      where: { slug: primary },
      select: { id: true },
    });
    if (!existing) return primary;

    const withId = normalizeSlug(`${primary}-${externalId}`) || fallback;
    const existingWithId = await this.animeRepo.findOne({
      where: { slug: withId },
      select: { id: true },
    });
    if (!existingWithId) return withId;
    return fallback;
  }

  private toMalSearchItem(
    media: MalMappedMedia,
    local?: { id: string; slug: string | null } | null,
  ) {
    return {
      mal_id: media.mal_id,
      anilist_id: media.anilist_id,
      title: media.title,
      title_romaji: media.title_romaji,
      title_native: media.title_native,
      cover_image: media.cover_image,
      format: media.format,
      season: media.season,
      year: media.year,
      status: media.airing_status,
      genres: media.genres,
      local_anime_id: local?.id ?? null,
      local_slug: local?.slug ?? null,
    };
  }

  async searchMal(query?: string) {
    const q = String(query ?? '').trim();
    if (q.length < 2) {
      throw new BadRequestException('حداقل ۲ حرف برای جستجو لازم است');
    }

    const media = await searchMalAnime(q, 12).catch((err) =>
      this.throwMalUnavailable(err),
    );

    const malIds = media.map((item) => item.mal_id);
    const locals =
      malIds.length > 0
        ? await this.animeRepo.find({
            where: { malId: In(malIds) },
            select: { id: true, slug: true, malId: true },
          })
        : [];
    const localByMal = new Map(
      locals
        .filter((row) => row.malId != null)
        .map((row) => [Number(row.malId), { id: row.id, slug: row.slug }]),
    );

    return {
      items: media.map((item) =>
        this.toMalSearchItem(item, localByMal.get(item.mal_id) ?? null),
      ),
    };
  }

  async importFromMal(body: Payload, editorId?: string) {
    const malId = normalizeExternalId(this.pick<unknown>(body, 'mal_id', 'malId'));
    if (!malId) {
      throw new BadRequestException('شناسه MyAnimeList نامعتبر است');
    }

    const existing = await this.animeRepo.findOne({
      where: { malId },
      relations: { lastEditedBy: true },
    });
    if (existing) {
      return { existed: true, ...this.toAnimeAdminRow(existing) };
    }

    const media = await fetchMalAnimeById(malId).catch((err) =>
      this.throwMalUnavailable(err),
    );
    if (!media) {
      throw new NotFoundException('این اثر در MyAnimeList پیدا نشد');
    }

    const already = await this.animeRepo.findOne({
      where: { malId: media.mal_id },
      relations: { lastEditedBy: true },
    });
    if (already) {
      return { existed: true, ...this.toAnimeAdminRow(already) };
    }

    const [genres, studios] = await Promise.all([
      this.genreRepo.find(),
      this.studioRepo.find(),
    ]);
    const genreSlugs = this.matchLocalGenreSlugs(media.genres, genres);
    const studioMatch = this.matchLocalStudioSlugs(media.studios, studios);
    const slug = await this.uniqueImportSlug(
      media.title_romaji ?? media.title,
      media.mal_id,
      'mal',
    );

    const created = await this.createAnime(
      {
        title: media.title,
        title_romaji: media.title_romaji,
        slug,
        synopsis: media.synopsis,
        cover_image: media.cover_image,
        featured_image: media.featured_image,
        format: media.format,
        season: media.season,
        year: media.year,
        airing_status: media.airing_status,
        episodes_count: media.episodes_count,
        anilist_id: media.anilist_id,
        mal_id: media.mal_id,
        start_date: media.start_date,
        end_date: media.end_date,
        studio: studioMatch.displayName,
        genre_slugs: genreSlugs,
        studio_slugs: studioMatch.slugs,
        is_featured: false,
      },
      editorId,
    );

    const refreshed = await this.getAnimeAdmin(created.id);
    return { existed: false, ...refreshed };
  }

  async fillFromMal(body: Payload) {
    const malId = normalizeExternalId(this.pick<unknown>(body, 'mal_id', 'malId'));
    if (!malId) {
      throw new BadRequestException('شناسه MyAnimeList نامعتبر است');
    }

    const media = await fetchMalAnimeById(malId).catch((err) =>
      this.throwMalUnavailable(err),
    );
    if (!media) {
      throw new NotFoundException('این اثر در MyAnimeList پیدا نشد');
    }

    const [genres, studios] = await Promise.all([
      this.genreRepo.find(),
      this.studioRepo.find(),
    ]);
    const genreSlugs = this.matchLocalGenreSlugs(media.genres, genres);
    const studioMatch = this.matchLocalStudioSlugs(media.studios, studios);

    return {
      mal_id: media.mal_id,
      anilist_id: media.anilist_id,
      title: media.title,
      title_romaji: media.title_romaji,
      synopsis: media.synopsis,
      cover_image: media.cover_image,
      featured_image: media.featured_image,
      format: media.format,
      season: media.season,
      year: media.year,
      airing_status: media.airing_status,
      episodes_count: media.episodes_count,
      start_date: media.start_date,
      end_date: media.end_date,
      studio: studioMatch.displayName,
      genre_slugs: genreSlugs,
      studio_slugs: studioMatch.slugs,
    };
  }

  async createAnime(body: Payload, editorId?: string) {
    const title = this.pick<string>(body, 'title', 'title');
    if (!title?.trim()) throw new BadRequestException('title is required');
    const anime = this.applyAnimeFields(
      this.animeRepo.create({ title: title.trim(), isFeatured: false }),
      body,
    );
    await this.assertAnimeSlugAvailable(anime.slug);
    this.markAdminEdited(anime, editorId);
    const saved = await this.animeRepo.save(anime);
    const genreSlugs = this.pick<string[]>(body, 'genre_slugs', 'genreSlugs');
    if (genreSlugs) await this.replaceGenreSlugs(saved.id, genreSlugs);
    const studioSlugs = this.pick<string[]>(body, 'studio_slugs', 'studioSlugs');
    if (studioSlugs) await this.replaceStudioSlugs(saved.id, studioSlugs);
    return this.getAnimeAdmin(saved.id);
  }

  async updateAnime(idOrSlug: string, body: Payload, editorId?: string) {
    const anime = await this.requireAnime(idOrSlug);
    const id = anime.id;
    this.applyAnimeFields(anime, body);
    await this.assertAnimeSlugAvailable(anime.slug, id);
    this.markAdminEdited(anime, editorId);
    await this.animeRepo.save(anime);
    const genreSlugs = this.pick<string[]>(body, 'genre_slugs', 'genreSlugs');
    if (genreSlugs) await this.replaceGenreSlugs(id, genreSlugs);
    const studioSlugs = this.pick<string[]>(body, 'studio_slugs', 'studioSlugs');
    if (studioSlugs) await this.replaceStudioSlugs(id, studioSlugs);
    return this.getAnimeAdmin(id);
  }

  async upsertAnime(body: Payload, editorId?: string) {
    const id = this.pick<string>(body, 'id', 'id');
    if (id) return this.updateAnime(String(id), body, editorId);
    return this.createAnime(body, editorId);
  }

  async deleteAnime(idOrSlug: string) {
    const anime = await this.requireAnime(idOrSlug);
    const animeId = anime.id;

    await this.dataSource.transaction(async (manager) => {
      await manager.delete(UserAnimeListEntry, { animeId });
      await manager.delete(UserCustomListItem, { animeId });
      await manager.delete(UserNotification, { animeId });
      await manager.delete(AnimeEpisode, { animeId });
      await manager.delete(AnimeSubtitle, { animeId });
      await manager.delete(AnimeSubtitlePack, { animeId });
      await manager.delete(AnimeGenreLink, { animeId });
      await manager.delete(AnimeStudioLink, { animeId });
      await manager.delete(AnimeTranslatorLink, { animeId });
      await manager.delete(AnimeSeriesMember, { animeId });

      await manager
        .createQueryBuilder()
        .update(Anime)
        .set({ prevAnimeId: null })
        .where('prev_anime_id = :animeId', { animeId })
        .execute();
      await manager
        .createQueryBuilder()
        .update(Anime)
        .set({ nextAnimeId: null })
        .where('next_anime_id = :animeId', { animeId })
        .execute();

      await manager.delete(Anime, { id: animeId });
    });
  }

  private async resolveAnimeRecordId(idOrSlug: string): Promise<string> {
    return (await this.requireAnime(idOrSlug)).id;
  }

  async getAnimeGenreSlugs(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const links = await this.genreLinkRepo.find({
      where: { animeId },
      relations: { genre: true },
    });
    return links.map((l) => l.genre?.slug).filter(Boolean) as string[];
  }

  async getAnimeStudioSlugs(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const links = await this.studioLinkRepo.find({
      where: { animeId },
      relations: { studio: true },
    });
    return links.map((l) => l.studio?.slug).filter(Boolean) as string[];
  }

  async listEpisodes(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const episodes = await this.episodeRepo.find({
      where: { animeId },
      order: { episodeNumber: 'ASC' },
    });
    return episodes.map((e) => ({
      id: e.id,
      episode_number: e.episodeNumber ?? 0,
      title: e.title,
      download_link: e.downloadLink,
      video_file_type: normalizeEpisodeVideoFileType(e.videoFileType),
    }));
  }

  async insertEpisode(body: Payload) {
    const animeIdRaw = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    const animeId = await this.resolveAnimeRecordId(animeIdRaw);
    const videoFileTypeRaw = this.pick<string | null>(body, 'video_file_type', 'videoFileType');
    let videoFileType = videoFileTypeRaw != null ? normalizeEpisodeVideoFileType(videoFileTypeRaw) : null;
    if (!videoFileType) {
      const anime = await this.animeRepo.findOne({
        where: { id: animeId },
        select: { id: true, videoFileType: true },
      });
      videoFileType = normalizeEpisodeVideoFileType(anime?.videoFileType);
    }
    const episode = this.episodeRepo.create({
      animeId,
      episodeNumber: Number(this.pick(body, 'episode_number', 'episodeNumber') ?? 0),
      title: (this.pick<string | null>(body, 'title', 'title') ?? null),
      downloadLink: (this.pick<string | null>(body, 'download_link', 'downloadLink') ?? null),
      videoFileType,
    });
    const saved = await this.episodeRepo.save(episode);
    await this.touchAnimeLastEpisodeAt(animeId, saved.createdAt ?? new Date());

    const episodeNumber = saved.episodeNumber ?? 0;
    if (episodeNumber > 0) {
      // createdBy must be a telegram user id or null — 'auto' breaks bigint FK and was swallowed.
      void this.notificationsAdminService
        .notifyEpisodeRelease(
          { animeId, episodeNumber, sendTelegram: true },
          null,
        )
        .catch((err: unknown) => {
          const msg = err instanceof Error ? err.message : String(err);
          this.logger.warn(
            `Auto notify failed for anime=${animeId} ep=${episodeNumber}: ${msg}`,
          );
        });
    }

    return {
      id: saved.id,
      episode_number: saved.episodeNumber ?? 0,
      title: saved.title,
      download_link: saved.downloadLink,
      video_file_type: normalizeEpisodeVideoFileType(saved.videoFileType),
    };
  }

  /**
   * Queue a channel-post draft preview for tel-bot (manual from admin panel).
   */
  async queueChannelDraftPreview(
    animeIdOrSlug: string,
    episodeNumber: number,
    requestedByTelegramId?: string | number | null,
  ) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const ep = Number(episodeNumber);
    if (!Number.isFinite(ep) || ep <= 0) {
      throw new BadRequestException('episode_number required');
    }
    return this.channelDraftsService.createFromEpisode(animeId, ep, {
      requestedByTelegramId,
    });
  }

  async insertEpisodesBatch(animeIdOrSlug: string, episodes: Payload[]) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const created = [];
    for (const ep of episodes) {
      created.push(await this.insertEpisode({ ...ep, anime_id: animeId }));
    }
    return created;
  }

  async updateEpisode(id: string, body: Payload) {
    const episode = await this.episodeRepo.findOne({ where: { id } });
    if (!episode) throw new NotFoundException('Episode not found');
    const hadDownloadLink = Boolean(String(episode.downloadLink ?? '').trim());
    const epNum = this.pick<number>(body, 'episode_number', 'episodeNumber');
    if (epNum !== undefined) episode.episodeNumber = epNum;
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) episode.title = title;
    const link = this.pick<string | null>(body, 'download_link', 'downloadLink');
    if (link !== undefined) episode.downloadLink = link;
    const videoFileType = this.pick<string | null>(body, 'video_file_type', 'videoFileType');
    if (videoFileType !== undefined) {
      episode.videoFileType = normalizeEpisodeVideoFileType(videoFileType);
    }
    const saved = await this.episodeRepo.save(episode);
    const hasDownloadLink = Boolean(String(saved.downloadLink ?? '').trim());
    // First time a download lands on an existing row → treat as a fresh release for home rails.
    if (!hadDownloadLink && hasDownloadLink) {
      await this.touchAnimeLastEpisodeAt(saved.animeId, new Date());
    }
    return {
      id: saved.id,
      episode_number: saved.episodeNumber ?? 0,
      title: saved.title,
      download_link: saved.downloadLink,
      video_file_type: normalizeEpisodeVideoFileType(saved.videoFileType),
    };
  }

  async deleteEpisode(id: string) {
    const episode = await this.episodeRepo.findOne({ where: { id } });
    if (!episode) throw new NotFoundException('Episode not found');
    const animeId = episode.animeId;
    await this.episodeRepo.remove(episode);
    await this.recomputeAnimeLastEpisodeAt(animeId);
  }

  /** Bump season-rail sort key without touching last_edited_at. */
  private async touchAnimeLastEpisodeAt(animeId: string, at: Date) {
    await this.animeRepo.query(
      `UPDATE anime
       SET last_episode_at = GREATEST(COALESCE(last_episode_at, TIMESTAMPTZ 'epoch'), $1::timestamptz)
       WHERE id = $2::uuid`,
      [at.toISOString(), animeId],
    );
  }

  private async recomputeAnimeLastEpisodeAt(animeId: string) {
    const row = await this.episodeRepo
      .createQueryBuilder('e')
      .select('MAX(e.createdAt)', 'max')
      .where('e.animeId = :animeId', { animeId })
      .getRawOne<{ max: Date | string | null }>();
    const maxAt = row?.max ? new Date(row.max) : null;
    await this.animeRepo.update(
      { id: animeId },
      { lastEpisodeAt: maxAt && Number.isFinite(maxAt.getTime()) ? maxAt : null },
    );
  }

  async updateEpisodePack(animeIdOrSlug: string, body: Payload, editorId?: string) {
    const anime = await this.requireAnime(animeIdOrSlug);
    anime.episodePackTitle = this.pick<string | null>(body, 'episode_pack_title', 'episodePackTitle') ?? null;
    anime.episodePackLink = this.pick<string | null>(body, 'episode_pack_link', 'episodePackLink') ?? null;
    this.markAdminEdited(anime, editorId);
    await this.animeRepo.save(anime);
  }

  private catalogListPaging(params?: CatalogAdminListParams) {
    const paginate = params?.page != null || params?.limit != null;
    const pageRaw = Number(params?.page);
    const limitRaw = Number(params?.limit);
    const page = Number.isFinite(pageRaw) && pageRaw > 0 ? Math.trunc(pageRaw) : 1;
    const limit =
      Number.isFinite(limitRaw) && limitRaw > 0
        ? Math.min(10_000, Math.trunc(limitRaw))
        : 50;
    const sortOrder: 'ASC' | 'DESC' = params?.sortOrder === 'DESC' ? 'DESC' : 'ASC';
    return { paginate, page, limit, sortOrder };
  }

  private catalogListResult<T, S>(
    items: T[],
    total: number,
    page: number,
    limit: number,
    summary: S,
  ) {
    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / Math.max(1, limit))),
      summary,
    };
  }

  private async studioAnimeCounts(ids: string[]) {
    if (ids.length === 0) return new Map<string, number>();
    const countRows = await this.studioLinkRepo
      .createQueryBuilder('l')
      .select('l.studioId', 'studioId')
      .addSelect('COUNT(DISTINCT l.animeId)', 'animeCount')
      .where('l.studioId IN (:...ids)', { ids })
      .groupBy('l.studioId')
      .getRawMany<{ studioId: string; animeCount: string }>();
    return new Map(
      countRows.map((row) => [
        String(row.studioId),
        Number.parseInt(String(row.animeCount ?? '0'), 10) || 0,
      ]),
    );
  }

  private async translatorLinkCounts(ids: string[]) {
    const animeCountByTranslator = new Map<string, number>();
    const episodeCountByTranslator = new Map<string, number>();
    if (ids.length === 0) {
      return { animeCountByTranslator, episodeCountByTranslator };
    }

    const animeCountRows = await this.translatorLinkRepo
      .createQueryBuilder('tal')
      .select('tal.translatorId', 'translatorId')
      .addSelect('COUNT(DISTINCT tal.animeId)', 'animeCount')
      .where('tal.translatorId IN (:...ids)', { ids })
      .groupBy('tal.translatorId')
      .getRawMany<{ translatorId: string; animeCount: string }>();
    for (const row of animeCountRows) {
      animeCountByTranslator.set(
        String(row.translatorId),
        Number.parseInt(String(row.animeCount ?? '0'), 10) || 0,
      );
    }

    const episodeRows = await this.translatorLinkRepo
      .createQueryBuilder('tal')
      .innerJoin(AnimeEpisode, 'e', 'e.animeId = tal.animeId')
      .select('tal.translatorId', 'translatorId')
      .addSelect('COUNT(e.id)', 'episodeCount')
      .where('tal.translatorId IN (:...ids)', { ids })
      .groupBy('tal.translatorId')
      .getRawMany<{ translatorId: string; episodeCount: string }>();
    for (const row of episodeRows) {
      episodeCountByTranslator.set(
        String(row.translatorId),
        Number.parseInt(String(row.episodeCount ?? '0'), 10) || 0,
      );
    }

    return { animeCountByTranslator, episodeCountByTranslator };
  }

  private async genreListSummary() {
    const [total, withFa, withEn] = await Promise.all([
      this.genreRepo.count(),
      this.genreRepo
        .createQueryBuilder('g')
        .where("g.name_fa IS NOT NULL AND TRIM(g.name_fa) <> ''")
        .getCount(),
      this.genreRepo
        .createQueryBuilder('g')
        .where("g.name_en IS NOT NULL AND TRIM(g.name_en) <> ''")
        .getCount(),
    ]);
    return { total, withFa, withEn };
  }

  private async studioListSummary() {
    const [total, linkedRaw] = await Promise.all([
      this.studioRepo.count(),
      this.studioLinkRepo
        .createQueryBuilder('l')
        .select('COUNT(DISTINCT l.animeId)', 'c')
        .getRawOne<{ c: string }>(),
    ]);
    return {
      total,
      linkedAnime: Number.parseInt(String(linkedRaw?.c ?? '0'), 10) || 0,
    };
  }

  private async translatorListSummary() {
    const [total, active, animeRaw, episodeRaw] = await Promise.all([
      this.translatorRepo.count(),
      this.translatorRepo.count({ where: { isActive: true } }),
      this.translatorLinkRepo
        .createQueryBuilder('tal')
        .select('COUNT(DISTINCT tal.animeId)', 'c')
        .getRawOne<{ c: string }>(),
      this.translatorLinkRepo
        .createQueryBuilder('tal')
        .innerJoin(AnimeEpisode, 'e', 'e.animeId = tal.animeId')
        .select('COUNT(e.id)', 'c')
        .getRawOne<{ c: string }>(),
    ]);
    return {
      total,
      active,
      anime: Number.parseInt(String(animeRaw?.c ?? '0'), 10) || 0,
      episodes: Number.parseInt(String(episodeRaw?.c ?? '0'), 10) || 0,
    };
  }

  async listGenres(params?: CatalogAdminListParams | string) {
    const query = typeof params === 'string' ? { search: params } : params;
    const { paginate, page, limit, sortOrder } = this.catalogListPaging(query);
    const qb = this.genreRepo.createQueryBuilder('g');
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.where(
        'LOWER(g.slug) LIKE :term OR LOWER(g.name_en) LIKE :term OR LOWER(g.name_fa) LIKE :term',
        { term },
      );
    }

    const sortBy = query?.sortBy;
    if (sortBy === 'name_en') {
      qb.orderBy('g.nameEn', sortOrder, 'NULLS LAST').addOrderBy('g.slug', 'ASC');
    } else if (sortBy === 'slug') {
      qb.orderBy('g.slug', sortOrder);
    } else if (sortBy === 'name_fa' || paginate) {
      qb.orderBy('g.nameFa', sortOrder, 'NULLS LAST').addOrderBy('g.slug', 'ASC');
    } else {
      qb.orderBy('g.slug', 'ASC');
    }

    if (!paginate) {
      return (await qb.getMany()).map((g) => this.toGenre(g));
    }

    const [rows, total] = await qb.skip((page - 1) * limit).take(limit).getManyAndCount();
    return this.catalogListResult(
      rows.map((g) => this.toGenre(g)),
      total,
      page,
      limit,
      await this.genreListSummary(),
    );
  }

  async upsertGenre(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const genre = await this.genreRepo.findOne({ where: { id } });
      if (!genre) throw new NotFoundException('Genre not found');
      const slug = body.slug !== undefined ? String(body.slug).trim() : genre.slug;
      if (!slug) throw new BadRequestException('slug is required');
      genre.slug = slug;
      if (body.name_en !== undefined || body.nameEn !== undefined) {
        genre.nameEn = (body.name_en as string) ?? (body.nameEn as string) ?? null;
      }
      if (body.name_fa !== undefined || body.nameFa !== undefined) {
        genre.nameFa = (body.name_fa as string) ?? (body.nameFa as string) ?? null;
      }
      if (body.image_url !== undefined || body.imageUrl !== undefined) {
        const raw = (body.image_url as string) ?? (body.imageUrl as string) ?? null;
        genre.imageUrl = raw != null && String(raw).trim() ? String(raw).trim() : null;
      }
      return this.toGenre(await this.genreRepo.save(genre));
    }
    const slug = String(body.slug ?? '').trim();
    if (!slug) throw new BadRequestException('slug is required');
    const imageRaw =
      (body.image_url as string) ?? (body.imageUrl as string) ?? null;
    const genre = this.genreRepo.create({
      slug,
      nameEn: (body.name_en as string) ?? (body.nameEn as string) ?? null,
      nameFa: (body.name_fa as string) ?? (body.nameFa as string) ?? null,
      imageUrl:
        imageRaw != null && String(imageRaw).trim()
          ? String(imageRaw).trim()
          : null,
    });
    return this.toGenre(await this.genreRepo.save(genre));
  }

  async deleteGenre(payload: { id?: string; slug?: string }) {
    if (!payload.id && !payload.slug) throw new BadRequestException('id or slug required');
    const genre = payload.id
      ? await this.genreRepo.findOne({ where: { id: payload.id } })
      : await this.genreRepo.findOne({ where: { slug: String(payload.slug) } });
    if (!genre) throw new NotFoundException('Genre not found');
    await this.genreRepo.remove(genre);
  }

  async listStudios(params?: CatalogAdminListParams | string) {
    const query = typeof params === 'string' ? { search: params } : params;
    const { paginate, page, limit, sortOrder } = this.catalogListPaging(query);
    const qb = this.studioRepo.createQueryBuilder('s');
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.where('LOWER(s.slug) LIKE :term OR LOWER(s.name) LIKE :term', { term });
    }

    const sortBy = query?.sortBy;
    if (sortBy === 'slug') {
      qb.orderBy('s.slug', sortOrder);
    } else if (sortBy === 'anime_count') {
      qb.orderBy(
        '(SELECT COUNT(DISTINCT l.anime_id) FROM anime_studios l WHERE l.studio_id = s.id)',
        sortOrder,
      ).addOrderBy('s.name', 'ASC');
    } else if (sortBy === 'name' || paginate) {
      qb.orderBy('s.name', sortOrder).addOrderBy('s.slug', 'ASC');
    } else {
      qb.orderBy('s.name', 'ASC');
    }

    const [rows, total] = paginate
      ? await qb.skip((page - 1) * limit).take(limit).getManyAndCount()
      : [await qb.getMany(), 0];
    const countByStudio = await this.studioAnimeCounts(rows.map((s) => s.id));
    const items = rows.map((s) =>
      this.toStudio({
        ...s,
        _animeCount: countByStudio.get(String(s.id)) ?? 0,
      }),
    );
    if (!paginate) return items;
    return this.catalogListResult(items, total, page, limit, await this.studioListSummary());
  }

  async upsertStudio(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const studio = await this.studioRepo.findOne({ where: { id } });
      if (!studio) throw new NotFoundException('Studio not found');
      if (body.slug !== undefined) studio.slug = String(body.slug).trim();
      if (body.name !== undefined) studio.name = String(body.name).trim();
      return this.toStudio(await this.studioRepo.save(studio));
    }
    const slug = String(body.slug ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!slug || !name) throw new BadRequestException('slug and name are required');
    return this.toStudio(await this.studioRepo.save(this.studioRepo.create({ slug, name })));
  }

  async deleteStudio(id: string) {
    const studio = await this.studioRepo.findOne({ where: { id } });
    if (!studio) throw new NotFoundException('Studio not found');
    await this.studioRepo.remove(studio);
  }

  async replaceAnimeStudios(animeIdOrSlug: string, slugs: string[]) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    await this.replaceStudioSlugs(animeId, slugs);
  }

  async listTranslators(params?: CatalogAdminListParams | string) {
    const query = typeof params === 'string' ? { search: params } : params;
    const { paginate, page, limit, sortOrder } = this.catalogListPaging(query);
    const qb = this.translatorRepo.createQueryBuilder('t');
    if (query?.search?.trim()) {
      const term = `%${query.search.trim().toLowerCase()}%`;
      qb.where('LOWER(t.slug) LIKE :term OR LOWER(t.name) LIKE :term', { term });
    }

    const sortBy = query?.sortBy;
    if (sortBy === 'slug') {
      qb.orderBy('t.slug', sortOrder);
    } else if (sortBy === 'anime_count') {
      qb.orderBy(
        '(SELECT COUNT(DISTINCT tal.anime_id) FROM translator_anime tal WHERE tal.translator_id = t.id)',
        sortOrder,
      ).addOrderBy('t.name', 'ASC');
    } else if (sortBy === 'episode_count') {
      qb.orderBy(
        '(SELECT COUNT(e.id) FROM translator_anime tal INNER JOIN episodes e ON e.anime_id = tal.anime_id WHERE tal.translator_id = t.id)',
        sortOrder,
      ).addOrderBy('t.name', 'ASC');
    } else if (sortBy === 'name' || paginate) {
      qb.orderBy('t.name', sortOrder).addOrderBy('t.slug', 'ASC');
    } else {
      qb.orderBy('t.name', 'ASC');
    }

    const [rows, total] = paginate
      ? await qb.skip((page - 1) * limit).take(limit).getManyAndCount()
      : [await qb.getMany(), 0];
    const { animeCountByTranslator, episodeCountByTranslator } =
      await this.translatorLinkCounts(rows.map((t) => t.id));
    const items = rows.map((t) =>
      this.toTranslator({
        ...t,
        _animeCount: animeCountByTranslator.get(String(t.id)) ?? 0,
        _episodeCount: episodeCountByTranslator.get(String(t.id)) ?? 0,
      }),
    );
    if (!paginate) return items;
    return this.catalogListResult(items, total, page, limit, await this.translatorListSummary());
  }

  async upsertTranslator(body: Payload) {
    const id = body.id ? String(body.id) : null;
    if (id) {
      const t = await this.translatorRepo.findOne({ where: { id } });
      if (!t) throw new NotFoundException('Translator not found');
      if (body.slug !== undefined) t.slug = String(body.slug).trim();
      if (body.name !== undefined) t.name = String(body.name).trim();
      if (body.avatar_url !== undefined || body.avatarUrl !== undefined) {
        t.avatarUrl = (body.avatar_url as string) ?? (body.avatarUrl as string) ?? null;
      }
      if (body.cover_url !== undefined || body.coverUrl !== undefined) {
        t.coverUrl = (body.cover_url as string) ?? (body.coverUrl as string) ?? null;
      }
      if (body.bio !== undefined) t.bio = (body.bio as string) ?? null;
      if (body.experience !== undefined) t.experience = (body.experience as string) ?? null;
      if (body.is_active !== undefined) t.isActive = Boolean(body.is_active);
      if (body.isActive !== undefined) t.isActive = Boolean(body.isActive);
      return this.toTranslator(await this.translatorRepo.save(t));
    }
    const slug = String(body.slug ?? '').trim();
    const name = String(body.name ?? '').trim();
    if (!slug || !name) throw new BadRequestException('slug and name are required');
    const t = this.translatorRepo.create({
      slug,
      name,
      avatarUrl: (body.avatar_url as string) ?? null,
      coverUrl: (body.cover_url as string) ?? null,
      bio: (body.bio as string) ?? null,
      experience: (body.experience as string) ?? null,
      isActive: body.is_active !== undefined ? Boolean(body.is_active) : true,
    });
    return this.toTranslator(await this.translatorRepo.save(t));
  }

  async deleteTranslator(id: string) {
    const t = await this.translatorRepo.findOne({ where: { id } });
    if (!t) throw new NotFoundException('Translator not found');
    await this.translatorRepo.remove(t);
  }

  async listSubtitles(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const rows = await this.subtitleRepo.find({
      where: { animeId },
      order: { episodeNumber: 'ASC' },
    });
    return rows.map((s) => ({
      id: s.id,
      episode_number: s.episodeNumber,
      title: s.title,
      subtitle_link: s.subtitleLink,
    }));
  }

  async insertSubtitle(body: Payload) {
    const animeIdRaw = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    const animeId = await this.resolveAnimeRecordId(animeIdRaw);
    const saved = await this.subtitleRepo.save(
      this.subtitleRepo.create({
        animeId,
        episodeNumber: Number(this.pick(body, 'episode_number', 'episodeNumber') ?? 0),
        title: (this.pick<string | null>(body, 'title', 'title') ?? null),
        subtitleLink: (this.pick<string | null>(body, 'subtitle_link', 'subtitleLink') ?? null),
      }),
    );
    return {
      id: saved.id,
      episode_number: saved.episodeNumber,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async insertSubtitlesBatch(animeIdOrSlug: string, subtitles: Payload[]) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const created = [];
    for (const row of subtitles) {
      created.push(await this.insertSubtitle({ ...row, anime_id: animeId }));
    }
    return created;
  }

  async updateSubtitle(id: string, body: Payload) {
    const sub = await this.subtitleRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Subtitle not found');
    const epNum = this.pick<number>(body, 'episode_number', 'episodeNumber');
    if (epNum !== undefined) sub.episodeNumber = epNum;
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) sub.title = title;
    const link = this.pick<string | null>(body, 'subtitle_link', 'subtitleLink');
    if (link !== undefined) sub.subtitleLink = link;
    const saved = await this.subtitleRepo.save(sub);
    return {
      id: saved.id,
      episode_number: saved.episodeNumber,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async deleteSubtitle(id: string) {
    const sub = await this.subtitleRepo.findOne({ where: { id } });
    if (!sub) throw new NotFoundException('Subtitle not found');
    await this.subtitleRepo.remove(sub);
  }

  async listSubtitlePacks(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const packs = await this.subtitlePackRepo.find({
      where: { animeId },
      order: { id: 'ASC' },
    });
    return packs.map((p) => ({
      id: p.id,
      title: p.title,
      subtitle_link: p.subtitleLink,
    }));
  }

  async insertSubtitlePack(body: Payload) {
    const animeIdRaw = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    const animeId = await this.resolveAnimeRecordId(animeIdRaw);
    const saved = await this.subtitlePackRepo.save(
      this.subtitlePackRepo.create({
        animeId,
        title: (this.pick<string | null>(body, 'title', 'title') ?? null),
        subtitleLink: (this.pick<string | null>(body, 'subtitle_link', 'subtitleLink') ?? null),
      }),
    );
    return {
      id: saved.id,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async updateSubtitlePack(id: string, body: Payload) {
    const pack = await this.subtitlePackRepo.findOne({ where: { id } });
    if (!pack) throw new NotFoundException('Subtitle pack not found');
    const title = this.pick<string | null>(body, 'title', 'title');
    if (title !== undefined) pack.title = title;
    const link = this.pick<string | null>(body, 'subtitle_link', 'subtitleLink');
    if (link !== undefined) pack.subtitleLink = link;
    const saved = await this.subtitlePackRepo.save(pack);
    return {
      id: saved.id,
      title: saved.title,
      subtitle_link: saved.subtitleLink,
    };
  }

  async deleteSubtitlePack(id: string) {
    const pack = await this.subtitlePackRepo.findOne({ where: { id } });
    if (!pack) throw new NotFoundException('Subtitle pack not found');
    await this.subtitlePackRepo.remove(pack);
  }

  async listTranslatorLinks(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const links = await this.translatorLinkRepo.find({
      where: { animeId },
      relations: { translator: true },
    });
    return links.map((l) => ({
      id: l.id,
      anime_id: l.animeId,
      translator_id: l.translatorId,
      role: l.role,
      translator: l.translator ? this.toTranslator(l.translator) : null,
    }));
  }

  async insertTranslatorLink(body: Payload) {
    const animeIdRaw = String(this.pick<string>(body, 'anime_id', 'animeId') ?? '');
    const translatorId = String(this.pick<string>(body, 'translator_id', 'translatorId') ?? '');
    const animeId = await this.resolveAnimeRecordId(animeIdRaw);
    const saved = await this.translatorLinkRepo.save(
      this.translatorLinkRepo.create({
        animeId,
        translatorId,
        role: (this.pick<string | null>(body, 'role', 'role') ?? null),
      }),
    );
    return { id: saved.id };
  }

  async updateTranslatorLink(id: string, body: Payload) {
    const link = await this.translatorLinkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Translator link not found');
    const role = this.pick<string | null>(body, 'role', 'role');
    if (role !== undefined) link.role = role;
    const translatorId = this.pick<string>(body, 'translator_id', 'translatorId');
    if (translatorId !== undefined) {
      const trimmed = String(translatorId).trim();
      if (!trimmed) throw new BadRequestException('translator_id is required');
      link.translatorId = trimmed;
    }
    await this.translatorLinkRepo.save(link);
  }

  async deleteTranslatorLink(id: string) {
    const link = await this.translatorLinkRepo.findOne({ where: { id } });
    if (!link) throw new NotFoundException('Translator link not found');
    await this.translatorLinkRepo.remove(link);
  }

  async getSeriesDraft(animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const member = await this.seriesMemberRepo.findOne({
      where: { animeId },
      relations: { series: true },
    });
    if (!member?.series) {
      return { series_id: null, title: '', members: [] };
    }
    const members = await this.seriesMemberRepo.find({
      where: { seriesId: member.seriesId },
      order: { sortOrder: 'ASC' },
      relations: { anime: true },
    });
    return {
      series_id: member.seriesId,
      title: member.series.title,
      members: members.map((m) => ({
        anime_id: m.animeId,
        sort_order: m.sortOrder,
        label_fa: m.labelFa,
        title: m.anime?.title ?? null,
        title_romaji: m.anime?.titleRomaji ?? null,
        slug: m.anime?.slug ?? null,
      })),
    };
  }

  async saveSeries(animeIdOrSlug: string, body: Payload) {
    const animeId = await this.resolveAnimeRecordId(animeIdOrSlug);
    const seriesId = this.pick<string | null>(body, 'series_id', 'seriesId');
    const title = String(this.pick(body, 'title', 'title') ?? '');
    const members = (this.pick<Payload[]>(body, 'members', 'members') ?? []) as Payload[];

    if (!seriesId && members.length === 0) {
      const existing = await this.seriesMemberRepo.findOne({ where: { animeId } });
      if (existing) {
        const sid = existing.seriesId;
        await this.seriesMemberRepo.delete({ seriesId: sid });
        const remaining = await this.seriesMemberRepo.count({ where: { seriesId: sid } });
        if (remaining === 0) await this.seriesRepo.delete({ id: sid });
      }
      return this.getSeriesDraft(animeId);
    }

    let series: AnimeSeries;
    if (seriesId) {
      const found = await this.seriesRepo.findOne({ where: { id: seriesId } });
      if (!found) throw new NotFoundException('Series not found');
      series = found;
      series.title = title;
      await this.seriesRepo.save(series);
      await this.seriesMemberRepo.delete({ seriesId: series.id });
    } else {
      series = await this.seriesRepo.save(this.seriesRepo.create({ title }));
    }

    const entities = members.map((m) =>
      this.seriesMemberRepo.create({
        seriesId: series.id,
        animeId: String(m.anime_id ?? m.animeId),
        sortOrder: Number(m.sort_order ?? m.sortOrder ?? 0),
        labelFa: (m.label_fa as string) ?? (m.labelFa as string) ?? null,
      }),
    );
    if (entities.length > 0) await this.seriesMemberRepo.save(entities);
    return this.getSeriesDraft(animeId);
  }
}
