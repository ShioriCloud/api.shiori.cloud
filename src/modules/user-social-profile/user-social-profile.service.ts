import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeTranslator,
  AnimeTranslatorLink,
  TelegramUser,
  UserAnimeListEntry,
} from '../../entities';
import {
  isDownloadTokenWalletEnabledFor,
  parseDownloadTokenWalletMode,
  parseIdAllowlist,
  type DownloadTokenWalletMode,
} from '../download-tokens/download-token-wallet.util';

import {
  minutesForWatched,
  normalizeProfileFormat,
} from './watch-time.util';

export type SocialProfileWatchedItem = {
  anime_id: string;
  slug: string | null;
  title: string;
  image: string;
  episodes_watched: number;
  episodes_total: number | null;
  user_rating: number | null;
  updated_at: string;
};

export type SocialProfileMeResponse = {
  enabled: boolean;
  mode: DownloadTokenWalletMode;
  is_self?: boolean;
  telegram_user_id?: string;
  profile?: {
    display_name: string;
    username: string | null;
    photo_url: string | null;
    member_since: string;
    followers_count: number;
    following_count: number;
    role_badges: Array<{ id: string; title: string }>;
  };
  summary?: {
    anime_count: number;
    episodes_watched: number;
    ratings_count: number;
    average_rating: number | null;
    active_days: number;
    estimated_watch_hours: number;
    estimated_watch_label: string;
  };
  top_genres?: Array<{ slug: string; label: string; percent: number }>;
  by_format?: Array<{ format: string; count: number; episodes_watched: number }>;
  badges?: Array<{ id: string; title: string; is_new?: boolean }>;
  watched?: {
    items: SocialProfileWatchedItem[];
    total: number;
    page: number;
    limit: number;
  };
  translator?: {
    id: string;
    slug: string;
    name: string;
    bio: string | null;
    experience: string | null;
    is_active: boolean;
    anime_count: number;
    anime: Array<{
      anime_id: string;
      slug: string | null;
      title: string;
      image: string;
      role: string | null;
    }>;
  } | null;
};

@Injectable()
export class UserSocialProfileService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeTranslator)
    private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink)
    private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
  ) {}

  private async resolveLinkedTranslator(
    telegramUserId: string,
    username: string | null | undefined,
  ): Promise<AnimeTranslator | null> {
    const byId = await this.translatorRepo.findOne({
      where: { telegramUserId: String(telegramUserId) },
    });
    if (byId) return byId;

    const handle = String(username ?? '')
      .trim()
      .replace(/^@/, '')
      .toLowerCase();
    if (!handle) return null;

    // Soft match when admin set translator slug to the Telegram username.
    return this.translatorRepo
      .createQueryBuilder('t')
      .where('LOWER(t.slug) = :handle', { handle })
      .getOne();
  }

  private mode(): DownloadTokenWalletMode {
    return parseDownloadTokenWalletMode(
      this.config.get<string>('socialProfile.mode'),
    );
  }

  private allowlist(): Set<string> {
    return parseIdAllowlist(this.config.get<string>('socialProfile.allowlist'));
  }

  isEnabledFor(telegramUserId: string): boolean {
    return isDownloadTokenWalletEnabledFor(
      telegramUserId,
      this.mode(),
      this.allowlist(),
    );
  }

  /** Viewer must be in rollout; target must exist in telegram_users. */
  async getUser(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
    page = 1,
    limit = 60,
  ): Promise<SocialProfileMeResponse> {
    const mode = this.mode();
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, is_self: false };
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const payload = await this.buildProfilePayload(targetId, user, page, limit);
    return {
      enabled: true,
      mode,
      is_self: viewerId === targetId,
      telegram_user_id: targetId,
      ...payload,
    };
  }

  async getMe(
    telegramUserId: string,
    page = 1,
    limit = 60,
  ): Promise<SocialProfileMeResponse> {
    const mode = this.mode();
    const enabled = this.isEnabledFor(telegramUserId);
    if (!enabled) {
      return { enabled: false, mode, is_self: true };
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: String(telegramUserId) },
    });

    const payload = await this.buildProfilePayload(
      telegramUserId,
      user,
      page,
      limit,
    );
    return {
      enabled: true,
      mode,
      is_self: true,
      telegram_user_id: String(telegramUserId),
      ...payload,
    };
  }

  private async buildProfilePayload(
    telegramUserId: string,
    user: TelegramUser | null,
    page: number,
    limit: number,
  ): Promise<Omit<SocialProfileMeResponse, 'enabled' | 'mode' | 'is_self' | 'telegram_user_id'>> {
    const rows = await this.listRepo.find({
      where: { telegramUserId: String(telegramUserId) },
      order: { updatedAt: 'DESC' },
    });

    const animeIds = rows.map((r) => r.animeId);
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({
            where: { id: In(animeIds) },
            relations: { genreLinks: { genre: true } },
          })
        : [];
    const animeById = new Map(animes.map((a) => [a.id, a]));

    const ratings = rows
      .map((r) =>
        r.userRating != null && r.userRating !== '' ? Number(r.userRating) : null,
      )
      .filter((v): v is number => v != null && Number.isFinite(v));

    const episodesWatched = rows.reduce((sum, r) => sum + (r.episodesWatched ?? 0), 0);
    const activeDayKeys = new Set(
      rows.map((r) => r.updatedAt.toISOString().slice(0, 10)),
    );
    const estimatedMinutes = rows.reduce((sum, row) => {
      const anime = animeById.get(row.animeId);
      return sum + minutesForWatched(anime?.format, row.episodesWatched ?? 0);
    }, 0);
    const estimatedHours = Math.round(estimatedMinutes / 60);

    const genreCounts = new Map<string, { slug: string; label: string; count: number }>();
    for (const row of rows) {
      const anime = animeById.get(row.animeId);
      if (!anime?.genreLinks?.length) continue;
      for (const link of anime.genreLinks) {
        const genre = link.genre;
        if (!genre?.slug) continue;
        const key = genre.slug;
        const prev = genreCounts.get(key);
        if (prev) prev.count += 1;
        else {
          genreCounts.set(key, {
            slug: genre.slug,
            label: genre.nameFa?.trim() || genre.nameEn?.trim() || genre.slug,
            count: 1,
          });
        }
      }
    }

    const genreTotal = [...genreCounts.values()].reduce((s, g) => s + g.count, 0);
    const topGenres = [...genreCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 3)
      .map((g) => ({
        slug: g.slug,
        label: g.label,
        percent: genreTotal > 0 ? Math.round((g.count / genreTotal) * 100) : 0,
      }));

    const formatCounts = new Map<string, { count: number; episodes: number }>();
    for (const row of rows) {
      const anime = animeById.get(row.animeId);
      const format = normalizeProfileFormat(anime?.format);
      const bucket = formatCounts.get(format) ?? { count: 0, episodes: 0 };
      bucket.count += 1;
      bucket.episodes += row.episodesWatched ?? 0;
      formatCounts.set(format, bucket);
    }

    const byFormat = [...formatCounts.entries()]
      .map(([format, v]) => ({
        format,
        count: v.count,
        episodes_watched: v.episodes,
      }))
      .sort((a, b) => b.count - a.count);

    const badges: SocialProfileMeResponse['badges'] = [];
    if (rows.length >= 1) badges.push({ id: 'first_anime', title: 'اولین انیمه' });
    if (rows.length >= 10) badges.push({ id: 'ten_anime', title: '۱۰ انیمه' });
    if (episodesWatched >= 100) badges.push({ id: 'hundred_eps', title: '۱۰۰ قسمت', is_new: true });
    if (ratings.length >= 5) badges.push({ id: 'five_ratings', title: '۵ نمره' });

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const start = (safePage - 1) * safeLimit;
    const slice = rows.slice(start, start + safeLimit);

    const watchedItems: SocialProfileWatchedItem[] = slice.map((row) => {
      const anime = animeById.get(row.animeId);
      return {
        anime_id: row.animeId,
        slug: anime?.slug ?? null,
        title: anime?.title ?? '—',
        image: anime?.coverImage || anime?.featuredImage || '',
        episodes_watched: row.episodesWatched ?? 0,
        episodes_total: anime?.episodesCount ?? null,
        user_rating:
          row.userRating != null && row.userRating !== ''
            ? Number(row.userRating)
            : null,
        updated_at: row.updatedAt.toISOString(),
      };
    });

    const displayName =
      user?.firstName?.trim() ||
      user?.username?.trim() ||
      user?.email?.trim() ||
      'کاربر';

    const hideUsername = user?.hideTelegramUsername === true;
    const rawUsername = user?.username?.trim() || null;

    const linkedTranslator = await this.resolveLinkedTranslator(
      telegramUserId,
      rawUsername,
    );
    const roleBadges: Array<{ id: string; title: string }> = [];
    if (linkedTranslator) {
      roleBadges.push({ id: 'translator', title: 'مترجم' });
    }

    let translatorBlock: SocialProfileMeResponse['translator'] = null;
    if (linkedTranslator) {
      const links = await this.translatorLinkRepo.find({
        where: { translatorId: linkedTranslator.id },
        relations: { anime: true },
        order: { id: 'ASC' },
      });
      translatorBlock = {
        id: linkedTranslator.id,
        slug: linkedTranslator.slug,
        name: linkedTranslator.name,
        bio: linkedTranslator.bio,
        experience: linkedTranslator.experience,
        is_active: linkedTranslator.isActive !== false,
        anime_count: links.length,
        anime: links.map((link) => ({
          anime_id: link.animeId,
          slug: link.anime?.slug ?? null,
          title: link.anime?.title ?? '—',
          image: link.anime?.coverImage || link.anime?.featuredImage || '',
          role: link.role,
        })),
      };
    }

    return {
      profile: {
        display_name: displayName,
        username: hideUsername ? null : rawUsername,
        photo_url: user?.photoUrl?.trim() || null,
        member_since: (user?.firstSeenAt ?? new Date()).toISOString(),
        followers_count: 0,
        following_count: 0,
        role_badges: roleBadges,
      },
      summary: {
        anime_count: rows.length,
        episodes_watched: episodesWatched,
        ratings_count: ratings.length,
        average_rating:
          ratings.length > 0
            ? Math.round((ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10) / 10
            : null,
        active_days: activeDayKeys.size,
        estimated_watch_hours: estimatedHours,
        estimated_watch_label: '',
      },
      top_genres: topGenres,
      by_format: byFormat,
      badges,
      watched: {
        items: watchedItems,
        total: rows.length,
        page: safePage,
        limit: safeLimit,
      },
      translator: translatorBlock,
    };
  }
}
