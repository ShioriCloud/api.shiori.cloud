import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeComment,
  AnimeTranslator,
  AnimeTranslatorLink,
  TelegramUser,
  UserAnimeListEntry,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserSocialBadge,
  UserSocialFollow,
} from '../../entities';
import type { DownloadTokenWalletMode } from '../download-tokens/download-token-wallet.util';
import {
  isSocialProfileEnabledFor,
  SOCIAL_PROFILE_RESPONSE_MODE,
} from './social-profile-rollout.util';

import {
  eligibleSocialBadgeIds,
  SOCIAL_BADGE_NEW_MS,
  type SocialBadgeMetrics,
  socialBadgeTitle,
} from './social-profile-badges.util';
import { UserSocialModerationService } from './user-social-moderation.service';
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
  relationship?: {
    is_following: boolean;
    follows_you?: boolean;
    is_muted?: boolean;
    blocked_by_you?: boolean;
  };
  privacy?: {
    watch_activity_hidden: boolean;
  };
};

export type SocialProfileUserListItem = {
  telegram_user_id: string;
  display_name: string;
  username: string | null;
  photo_url: string | null;
  role_badges: Array<{ id: string; title: string }>;
};

export type SocialProfileUserListResponse = {
  enabled: boolean;
  mode: DownloadTokenWalletMode;
  items: SocialProfileUserListItem[];
  total: number;
  page: number;
  limit: number;
};

export type SocialProfileFeedAnimeRef = {
  anime_id: string;
  slug: string | null;
  title: string;
  image: string;
};

export type SocialProfileFeedItem =
  | {
      type: 'watch_progress' | 'rating' | 'list_add';
      actor: SocialProfileUserListItem;
      anime_id: string;
      slug: string | null;
      title: string;
      image: string;
      episodes_watched: number;
      episodes_total: number | null;
      user_rating: number | null;
      updated_at: string;
    }
  | {
      type: 'anime_comment';
      actor: SocialProfileUserListItem;
      comment_id: string;
      comment_preview: string;
      anime_id: string;
      slug: string | null;
      title: string;
      image: string;
      updated_at: string;
    }
  | {
      type: 'public_list_add';
      actor: SocialProfileUserListItem;
      list_id: string;
      list_name: string;
      anime_id: string;
      slug: string | null;
      title: string;
      image: string;
      updated_at: string;
    }
  | {
      type: 'user_follow';
      actor: SocialProfileUserListItem;
      target: SocialProfileUserListItem;
      updated_at: string;
    };

export type SocialProfileFeedResponse = {
  enabled: boolean;
  mode: DownloadTokenWalletMode;
  items: SocialProfileFeedItem[];
  total: number;
  page: number;
  limit: number;
};

export type SocialProfileFollowSuggestionItem = SocialProfileUserListItem & {
  mutual_connections: number;
};

export type SocialProfileFollowSuggestionsResponse = {
  enabled: boolean;
  mode: DownloadTokenWalletMode;
  items: SocialProfileFollowSuggestionItem[];
};

@Injectable()
export class UserSocialProfileService {
  constructor(
    private readonly moderation: UserSocialModerationService,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
    @InjectRepository(UserSocialFollow)
    private readonly followRepo: Repository<UserSocialFollow>,
    @InjectRepository(UserSocialBadge)
    private readonly badgeRepo: Repository<UserSocialBadge>,
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(UserCustomList)
    private readonly customListRepo: Repository<UserCustomList>,
    @InjectRepository(UserCustomListItem)
    private readonly customListItemRepo: Repository<UserCustomListItem>,
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeTranslator)
    private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink)
    private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
  ) {}

  private commentPreview(body: string, maxLen = 140): string {
    const flat = body.replace(/\s+/g, ' ').trim();
    if (flat.length <= maxLen) return flat;
    return `${flat.slice(0, maxLen - 1)}…`;
  }

  private classifyFeedType(
    row: UserAnimeListEntry,
  ): 'watch_progress' | 'rating' | 'list_add' {
    const eps = row.episodesWatched ?? 0;
    const ratingRaw =
      row.userRating != null && row.userRating !== ''
        ? Number(row.userRating)
        : null;
    const hasRating = ratingRaw != null && Number.isFinite(ratingRaw);
    if (eps > 0) return 'watch_progress';
    if (hasRating) return 'rating';
    return 'list_add';
  }

  private async resolveProfileBadges(
    telegramUserId: string,
    metrics: SocialBadgeMetrics,
  ): Promise<SocialProfileMeResponse['badges']> {
    const eligible = eligibleSocialBadgeIds(metrics);
    if (eligible.length === 0) return [];

    try {
      return await this.resolveProfileBadgesPersisted(telegramUserId, eligible);
    } catch {
      return eligible.map((id) => ({
        id,
        title: socialBadgeTitle(id),
      }));
    }
  }

  private async resolveProfileBadgesPersisted(
    telegramUserId: string,
    eligible: string[],
  ): Promise<SocialProfileMeResponse['badges']> {
    const userId = String(telegramUserId);
    const existing = await this.badgeRepo.find({
      where: { telegramUserId: userId },
    });
    const earnedById = new Map(existing.map((row) => [row.badgeId, row]));
    const now = new Date();
    const toCreate = eligible
      .filter((id) => !earnedById.has(id))
      .map((badgeId) =>
        this.badgeRepo.create({
          telegramUserId: userId,
          badgeId,
          earnedAt: now,
        }),
      );
    if (toCreate.length > 0) {
      await this.badgeRepo.save(toCreate);
      for (const row of toCreate) {
        earnedById.set(row.badgeId, row);
      }
    }

    const freshCutoff = Date.now() - SOCIAL_BADGE_NEW_MS;
    return eligible.map((id) => {
      const earned = earnedById.get(id);
      return {
        id,
        title: socialBadgeTitle(id),
        is_new: earned ? earned.earnedAt.getTime() >= freshCutoff : undefined,
      };
    });
  }

  private displayNameOf(user: TelegramUser): string {
    return (
      user.socialDisplayName?.trim() ||
      user.firstName?.trim() ||
      user.username?.trim() ||
      user.email?.trim() ||
      'کاربر'
    );
  }

  async updateMe(telegramUserId: string, displayName: string) {
    this.assertSocialEnabled(telegramUserId);
    const user = await this.usersRepo.findOne({
      where: { telegramUserId: String(telegramUserId) },
    });
    if (!user) throw new NotFoundException('User not found');
    const next = displayName.trim().slice(0, 40);
    if (next.length === 1) {
      throw new BadRequestException('display name too short');
    }
    user.socialDisplayName = next.length === 0 ? null : next;
    await this.usersRepo.save(user);
    return { ok: true as const, display_name: this.displayNameOf(user) };
  }

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
    return SOCIAL_PROFILE_RESPONSE_MODE;
  }

  isEnabledFor(telegramUserId: string): boolean {
    return isSocialProfileEnabledFor(telegramUserId);
  }

  private assertSocialEnabled(_viewerTelegramUserId: string): void {
    /* always enabled */
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
    if (viewerId !== targetId) {
      if (await this.moderation.arePeersBlocked(viewerId, targetId)) {
        throw new NotFoundException('User not found');
      }
    }

    const payload = await this.buildProfilePayload(
      targetId,
      user,
      page,
      limit,
      viewerId,
    );
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
      null,
    );
    return {
      enabled: true,
      mode,
      is_self: true,
      telegram_user_id: String(telegramUserId),
      ...payload,
    };
  }

  async follow(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    if (viewerId === targetId) {
      throw new BadRequestException('Cannot follow yourself');
    }
    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }
    if (await this.moderation.arePeersBlocked(viewerId, targetId)) {
      throw new BadRequestException('Cannot follow this user');
    }
    const existing = await this.followRepo.findOne({
      where: {
        followerTelegramUserId: viewerId,
        followingTelegramUserId: targetId,
      },
    });
    if (!existing) {
      await this.followRepo.save({
        followerTelegramUserId: viewerId,
        followingTelegramUserId: targetId,
      });

      const [follower, targetUser] = await Promise.all([
        this.usersRepo.findOne({ where: { telegramUserId: viewerId } }),
        this.usersRepo.findOne({ where: { telegramUserId: targetId } }),
      ]);
      const followerName = follower
        ? this.displayNameOf(follower)
        : 'یک کاربر';
      if (targetUser?.notifySocialFollow !== false) {
        await this.notificationsRepo.save(
          this.notificationsRepo.create({
            telegramUserId: targetId,
            kind: 'social_follow',
            title: 'دنبال‌کننده جدید',
            message: `${followerName} دنبالت کرد`,
            href: `/u/${encodeURIComponent(viewerId)}`,
            animeId: null,
            episodeNumber: null,
            campaignId: null,
            isRead: false,
          }),
        );
      }
    }
    return { ok: true, is_following: true };
  }

  async searchUsers(
    viewerTelegramUserId: string,
    query: string,
    limit = 20,
  ): Promise<SocialProfileUserListResponse> {
    const mode = this.mode();
    const viewerId = String(viewerTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, items: [], total: 0, page: 1, limit };
    }

    const q = String(query ?? '')
      .trim()
      .replace(/^@/, '')
      .slice(0, 64);
    if (q.length < 2) {
      return { enabled: true, mode, items: [], total: 0, page: 1, limit };
    }

    const safeLimit = Math.min(30, Math.max(1, limit));
    const like = `%${q.toLowerCase()}%`;
    const rows = await this.usersRepo
      .createQueryBuilder('u')
      .where('u.is_banned = false')
      .andWhere(
        `(LOWER(COALESCE(u.username, '')) LIKE :like
          OR LOWER(COALESCE(u.social_display_name, '')) LIKE :like
          OR LOWER(COALESCE(u.first_name, '')) LIKE :like
          OR LOWER(CONCAT(COALESCE(u.first_name, ''), ' ', COALESCE(u.last_name, ''))) LIKE :like)`,
        { like },
      )
      .orderBy('u.last_seen_at', 'DESC')
      .take(safeLimit)
      .getMany();

    const blocked = await this.moderation.blockedPeerIds(viewerId);
    const filtered = rows.filter(
      (u) => !blocked.has(String(u.telegramUserId)) && String(u.telegramUserId) !== viewerId,
    );
    const items = await this.loadProfileListUsers(
      filtered.map((u) => String(u.telegramUserId)),
    );

    return {
      enabled: true,
      mode,
      items,
      total: items.length,
      page: 1,
      limit: safeLimit,
    };
  }

  async blockUser(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    if (viewerId === targetId) {
      throw new BadRequestException('Cannot block yourself');
    }
    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) throw new NotFoundException('User not found');
    await this.moderation.blockUser(viewerId, targetId);
    return { ok: true as const, is_blocked: true };
  }

  async unblockUser(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    await this.moderation.unblockUser(viewerId, targetId);
    return { ok: true as const, is_blocked: false };
  }

  async muteUser(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    if (viewerId === targetId) {
      throw new BadRequestException('Cannot mute yourself');
    }
    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) throw new NotFoundException('User not found');
    await this.moderation.muteUser(viewerId, targetId);
    return { ok: true as const, is_muted: true };
  }

  async unmuteUser(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    await this.moderation.unmuteUser(viewerId, targetId);
    return { ok: true as const, is_muted: false };
  }

  async listBlockedUsers(viewerTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const mode = this.mode();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, items: [] as SocialProfileUserListItem[] };
    }
    const ids = await this.moderation.listBlockedUserIds(viewerId);
    const items = await this.loadProfileListUsers(ids);
    return { enabled: true, mode, items };
  }

  async unfollow(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled(viewerId);
    await this.followRepo.delete({
      followerTelegramUserId: viewerId,
      followingTelegramUserId: targetId,
    });
    return { ok: true, is_following: false };
  }

  async listFollowers(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
    page = 1,
    limit = 30,
  ): Promise<SocialProfileUserListResponse> {
    return this.listFollowEdges(
      viewerTelegramUserId,
      targetTelegramUserId,
      'followers',
      page,
      limit,
    );
  }

  async listFollowing(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
    page = 1,
    limit = 30,
  ): Promise<SocialProfileUserListResponse> {
    return this.listFollowEdges(
      viewerTelegramUserId,
      targetTelegramUserId,
      'following',
      page,
      limit,
    );
  }

  async getFollowSuggestions(
    viewerTelegramUserId: string,
    limit = 10,
  ): Promise<SocialProfileFollowSuggestionsResponse> {
    const mode = this.mode();
    const viewerId = String(viewerTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, items: [] };
    }

    const safeLimit = Math.min(20, Math.max(1, limit));
    const blocked = await this.moderation.blockedPeerIds(viewerId);

    const followingRows = await this.followRepo.find({
      where: { followerTelegramUserId: viewerId },
      select: { followingTelegramUserId: true },
    });
    const followingIds = followingRows.map((r) => r.followingTelegramUserId);
    const exclude = new Set<string>([viewerId, ...followingIds, ...blocked]);

    type Ranked = { candidate_id: string; score: number };
    let ranked: Ranked[] = [];

    if (followingIds.length > 0) {
      ranked = await this.followRepo
        .createQueryBuilder('f')
        .select('f.following_telegram_user_id', 'candidate_id')
        .addSelect('COUNT(*)', 'score')
        .where('f.follower_telegram_user_id IN (:...followingIds)', {
          followingIds,
        })
        .andWhere('f.following_telegram_user_id NOT IN (:...exclude)', {
          exclude: [...exclude],
        })
        .groupBy('f.following_telegram_user_id')
        .orderBy('score', 'DESC')
        .addOrderBy('f.following_telegram_user_id', 'ASC')
        .limit(safeLimit * 3)
        .getRawMany<{ candidate_id: string; score: string }>()
        .then((rows) =>
          rows.map((r) => ({
            candidate_id: String(r.candidate_id),
            score: Number(r.score) || 0,
          })),
        );
    } else {
      ranked = await this.followRepo
        .createQueryBuilder('f')
        .select('f.following_telegram_user_id', 'candidate_id')
        .addSelect('COUNT(*)', 'score')
        .where('f.following_telegram_user_id NOT IN (:...exclude)', {
          exclude: [...exclude],
        })
        .groupBy('f.following_telegram_user_id')
        .orderBy('score', 'DESC')
        .addOrderBy('f.following_telegram_user_id', 'ASC')
        .limit(safeLimit * 3)
        .getRawMany<{ candidate_id: string; score: string }>()
        .then((rows) =>
          rows.map((r) => ({
            candidate_id: String(r.candidate_id),
            score: Number(r.score) || 0,
          })),
        );
    }

    const scoreById = new Map(ranked.map((r) => [r.candidate_id, r.score]));
    const candidateIds = ranked.map((r) => r.candidate_id).slice(0, safeLimit);

    const users = await this.loadProfileListUsers(candidateIds);
    const items: SocialProfileFollowSuggestionItem[] = users.map((u) => ({
      ...u,
      mutual_connections: scoreById.get(u.telegram_user_id) ?? 0,
    }));

    return { enabled: true, mode, items };
  }

  async getFeed(
    viewerTelegramUserId: string,
    page = 1,
    limit = 30,
  ): Promise<SocialProfileFeedResponse> {
    const mode = this.mode();
    const viewerId = String(viewerTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, items: [], total: 0, page: 1, limit: 30 };
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));

    const followingRows = await this.followRepo.find({
      where: { followerTelegramUserId: viewerId },
      select: { followingTelegramUserId: true },
    });
    const followingIds = followingRows.map((r) => r.followingTelegramUserId);
    if (followingIds.length === 0) {
      return {
        enabled: true,
        mode,
        items: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
      };
    }

    const [blocked, muted] = await Promise.all([
      this.moderation.blockedPeerIds(viewerId),
      this.moderation.mutedUserIds(viewerId),
    ]);
    const followingFiltered = followingIds.filter(
      (id) => !blocked.has(String(id)) && !muted.has(String(id)),
    );
    if (followingFiltered.length === 0) {
      return {
        enabled: true,
        mode,
        items: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
      };
    }

    const followingUsers = await this.usersRepo.find({
      where: { telegramUserId: In(followingFiltered) },
      select: { telegramUserId: true, hideWatchActivity: true },
    });
    const visibleIds = followingUsers
      .filter((u) => u.hideWatchActivity !== true)
      .map((u) => String(u.telegramUserId));
    if (visibleIds.length === 0) {
      return {
        enabled: true,
        mode,
        items: [],
        total: 0,
        page: safePage,
        limit: safeLimit,
      };
    }

    const sourceCap = Math.min(120, safePage * safeLimit + safeLimit);

    const listWhere = {
      ids: visibleIds,
    };
    const listTotal = await this.listRepo
      .createQueryBuilder('list')
      .where('list.telegram_user_id IN (:...ids)', listWhere)
      .getCount();
    const listRows = await this.listRepo
      .createQueryBuilder('list')
      .where('list.telegram_user_id IN (:...ids)', listWhere)
      .orderBy('list.updated_at', 'DESC')
      .take(sourceCap)
      .getMany();

    const commentWhere = { ids: followingFiltered };
    const commentTotal = await this.commentsRepo
      .createQueryBuilder('c')
      .where('c.telegram_user_id IN (:...ids)', commentWhere)
      .andWhere('c.is_deleted = false')
      .andWhere('c.parent_id IS NULL')
      .getCount();
    const commentRows = await this.commentsRepo
      .createQueryBuilder('c')
      .where('c.telegram_user_id IN (:...ids)', commentWhere)
      .andWhere('c.is_deleted = false')
      .andWhere('c.parent_id IS NULL')
      .orderBy('c.created_at', 'DESC')
      .take(sourceCap)
      .getMany();

    const publicListWhere = { ids: followingFiltered };
    const publicListTotal = await this.customListItemRepo
      .createQueryBuilder('item')
      .innerJoin(UserCustomList, 'clist', 'clist.id = item.list_id')
      .where('clist.telegram_user_id IN (:...ids)', publicListWhere)
      .andWhere('clist.is_public = true')
      .getCount();
    const publicListRows = await this.customListItemRepo
      .createQueryBuilder('item')
      .innerJoin(UserCustomList, 'clist', 'clist.id = item.list_id')
      .where('clist.telegram_user_id IN (:...ids)', publicListWhere)
      .andWhere('clist.is_public = true')
      .orderBy('item.created_at', 'DESC')
      .select([
        'item.id AS item_id',
        'item.anime_id AS anime_id',
        'item.created_at AS created_at',
        'clist.id AS list_id',
        'clist.name AS list_name',
        'clist.telegram_user_id AS owner_id',
      ])
      .take(sourceCap)
      .getRawMany<{
        item_id: string;
        anime_id: string;
        created_at: Date;
        list_id: string;
        list_name: string;
        owner_id: string;
      }>();

    const followWhere = { ids: followingFiltered };
    const followTotal = await this.followRepo
      .createQueryBuilder('f')
      .where('f.follower_telegram_user_id IN (:...ids)', followWhere)
      .getCount();
    const followRows = await this.followRepo
      .createQueryBuilder('f')
      .where('f.follower_telegram_user_id IN (:...ids)', followWhere)
      .orderBy('f.created_at', 'DESC')
      .take(sourceCap)
      .getMany();

    const total = listTotal + commentTotal + publicListTotal + followTotal;

    type Staged = SocialProfileFeedItem & { sortTs: number };
    const staged: Staged[] = [];

    const actorIdSet = new Set<string>();
    const animeIdSet = new Set<string>();
    const targetIdSet = new Set<string>();

    for (const row of listRows) {
      actorIdSet.add(String(row.telegramUserId));
      animeIdSet.add(row.animeId);
    }
    for (const row of commentRows) {
      actorIdSet.add(String(row.telegramUserId));
      animeIdSet.add(row.animeId);
    }
    for (const row of publicListRows) {
      actorIdSet.add(String(row.owner_id));
      animeIdSet.add(row.anime_id);
    }
    for (const row of followRows) {
      actorIdSet.add(String(row.followerTelegramUserId));
      targetIdSet.add(String(row.followingTelegramUserId));
    }

    const blockedForTargets = await this.moderation.blockedPeerIds(viewerId);
    const filteredFollowRows = followRows.filter(
      (row) =>
        !blockedForTargets.has(String(row.followingTelegramUserId)) &&
        !muted.has(String(row.followingTelegramUserId)),
    );

    const actorIds = [...actorIdSet, ...targetIdSet];
    const actors = await this.loadProfileListUsers(actorIds);
    const actorById = new Map(actors.map((a) => [a.telegram_user_id, a]));

    const animeIds = [...animeIdSet];
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({ where: { id: In(animeIds) } })
        : [];
    const animeById = new Map(animes.map((a) => [a.id, a]));

    const animeCard = (animeId: string): SocialProfileFeedAnimeRef | null => {
      const anime = animeById.get(animeId);
      if (!anime) return null;
      return {
        anime_id: animeId,
        slug: anime.slug ?? null,
        title: anime.title ?? '—',
        image: anime.coverImage || anime.featuredImage || '',
      };
    };

    for (const row of listRows) {
      const actor = actorById.get(String(row.telegramUserId));
      const card = animeCard(row.animeId);
      if (!actor || !card) continue;
      const ratingRaw =
        row.userRating != null && row.userRating !== ''
          ? Number(row.userRating)
          : null;
      staged.push({
        type: this.classifyFeedType(row),
        actor,
        ...card,
        episodes_watched: row.episodesWatched ?? 0,
        episodes_total: animeById.get(row.animeId)?.episodesCount ?? null,
        user_rating:
          ratingRaw != null && Number.isFinite(ratingRaw) ? ratingRaw : null,
        updated_at: row.updatedAt.toISOString(),
        sortTs: row.updatedAt.getTime(),
      });
    }

    for (const row of commentRows) {
      const actor = actorById.get(String(row.telegramUserId));
      const card = animeCard(row.animeId);
      if (!actor || !card) continue;
      staged.push({
        type: 'anime_comment',
        actor,
        comment_id: row.id,
        comment_preview: this.commentPreview(row.body),
        ...card,
        updated_at: row.createdAt.toISOString(),
        sortTs: row.createdAt.getTime(),
      });
    }

    for (const row of publicListRows) {
      const actor = actorById.get(String(row.owner_id));
      const card = animeCard(row.anime_id);
      if (!actor || !card) continue;
      staged.push({
        type: 'public_list_add',
        actor,
        list_id: row.list_id,
        list_name: row.list_name,
        ...card,
        updated_at: new Date(row.created_at).toISOString(),
        sortTs: new Date(row.created_at).getTime(),
      });
    }

    for (const row of filteredFollowRows) {
      const actor = actorById.get(String(row.followerTelegramUserId));
      const target = actorById.get(String(row.followingTelegramUserId));
      if (!actor || !target) continue;
      staged.push({
        type: 'user_follow',
        actor,
        target,
        updated_at: row.createdAt.toISOString(),
        sortTs: row.createdAt.getTime(),
      });
    }

    staged.sort((a, b) => b.sortTs - a.sortTs);
    const skip = (safePage - 1) * safeLimit;
    const items: SocialProfileFeedItem[] = staged
      .slice(skip, skip + safeLimit)
      .map(({ sortTs: _sortTs, ...item }) => item);

    return {
      enabled: true,
      mode,
      items,
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  private async listFollowEdges(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
    edge: 'followers' | 'following',
    page: number,
    limit: number,
  ): Promise<SocialProfileUserListResponse> {
    const mode = this.mode();
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return { enabled: false, mode, items: [], total: 0, page: 1, limit: 30 };
    }

    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const where =
      edge === 'followers'
        ? { followingTelegramUserId: targetId }
        : { followerTelegramUserId: targetId };

    const [edges, total] = await this.followRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const userIds =
      edge === 'followers'
        ? edges.map((e) => e.followerTelegramUserId)
        : edges.map((e) => e.followingTelegramUserId);

    const blocked =
      viewerId !== targetId
        ? await this.moderation.blockedPeerIds(viewerId)
        : new Set<string>();
    const filteredIds = this.moderation.filterUserIds(userIds, blocked);
    const items = await this.loadProfileListUsers(filteredIds);

    return {
      enabled: true,
      mode,
      items,
      total: items.length < userIds.length ? items.length : total,
      page: safePage,
      limit: safeLimit,
    };
  }

  private async loadProfileListUsers(
    telegramUserIds: string[],
  ): Promise<SocialProfileUserListItem[]> {
    const unique = [...new Set(telegramUserIds.map(String))].filter(Boolean);
    if (unique.length === 0) return [];

    const users = await this.usersRepo.find({
      where: { telegramUserId: In(unique) },
    });
    const userById = new Map(users.map((u) => [String(u.telegramUserId), u]));

    const translators = await this.translatorRepo.find({
      where: { telegramUserId: In(unique) },
    });
    const translatorByUserId = new Map(
      translators
        .filter((t) => t.telegramUserId)
        .map((t) => [String(t.telegramUserId), t]),
    );

    return unique
      .map((id) => {
        const user = userById.get(id);
        if (!user) return null;
        return this.toProfileListUser(
          user,
          translatorByUserId.get(id) ?? null,
        );
      })
      .filter((x): x is SocialProfileUserListItem => x != null);
  }

  private toProfileListUser(
    user: TelegramUser,
    linkedTranslator: AnimeTranslator | null,
  ): SocialProfileUserListItem {
    const roleBadges: Array<{ id: string; title: string }> = [];
    if (linkedTranslator) {
      roleBadges.push({ id: 'translator', title: 'مترجم' });
    }
    return {
      telegram_user_id: String(user.telegramUserId),
      display_name:
        user.socialDisplayName?.trim() ||
        user.firstName?.trim() ||
        user.username?.trim() ||
        user.email?.trim() ||
        'کاربر',
      username: null,
      photo_url: user.photoUrl?.trim() || null,
      role_badges: roleBadges,
    };
  }

  private async buildProfilePayload(
    telegramUserId: string,
    user: TelegramUser | null,
    page: number,
    limit: number,
    viewerTelegramUserId?: string | null,
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

    const targetId = String(telegramUserId);
    const [followersCount, followingCount, commentsCount, publicListsCount] =
      await Promise.all([
        this.followRepo.count({ where: { followingTelegramUserId: targetId } }),
        this.followRepo.count({ where: { followerTelegramUserId: targetId } }),
        this.commentsRepo.count({
          where: { telegramUserId: targetId, isDeleted: false },
        }),
        this.customListRepo.count({
          where: { telegramUserId: targetId, isPublic: true },
        }),
      ]);

    const badgeMetrics: SocialBadgeMetrics = {
      animeCount: rows.length,
      episodesWatched,
      ratingsCount: ratings.length,
      activeDays: activeDayKeys.size,
      watchHours: estimatedHours,
      followersCount,
      followingCount,
      commentsCount,
      publicListsCount,
    };

    const badges = await this.resolveProfileBadges(targetId, badgeMetrics);

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
      user?.socialDisplayName?.trim() ||
      user?.firstName?.trim() ||
      user?.username?.trim() ||
      user?.email?.trim() ||
      'کاربر';

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

    let relationship: SocialProfileMeResponse['relationship'];
    const viewerId = viewerTelegramUserId?.trim();
    if (viewerId && viewerId !== targetId) {
      const [isFollowing, followsYou, isMuted, blockedByYou] = await Promise.all([
        this.followRepo.exists({
          where: {
            followerTelegramUserId: viewerId,
            followingTelegramUserId: targetId,
          },
        }),
        this.followRepo.exists({
          where: {
            followerTelegramUserId: targetId,
            followingTelegramUserId: viewerId,
          },
        }),
        this.moderation.isMutedBy(viewerId, targetId),
        this.moderation.hasBlocked(viewerId, targetId),
      ]);
      relationship = {
        is_following: isFollowing,
        follows_you: followsYou,
        is_muted: isMuted,
        blocked_by_you: blockedByYou,
      };
    }

    const isSelf = !viewerId || viewerId === targetId;
    const watchHidden =
      !isSelf && user?.hideWatchActivity === true;

    return {
      profile: {
        display_name: displayName,
        username: null,
        photo_url: user?.photoUrl?.trim() || null,
        member_since: (user?.firstSeenAt ?? new Date()).toISOString(),
        followers_count: followersCount,
        following_count: followingCount,
        role_badges: roleBadges,
      },
      relationship,
      privacy: {
        watch_activity_hidden: watchHidden,
      },
      summary: watchHidden
        ? {
            anime_count: 0,
            episodes_watched: 0,
            ratings_count: 0,
            average_rating: null,
            active_days: 0,
            estimated_watch_hours: 0,
            estimated_watch_label: '',
          }
        : {
            anime_count: rows.length,
            episodes_watched: episodesWatched,
            ratings_count: ratings.length,
            average_rating:
              ratings.length > 0
                ? Math.round(
                    (ratings.reduce((a, b) => a + b, 0) / ratings.length) * 10,
                  ) / 10
                : null,
            active_days: activeDayKeys.size,
            estimated_watch_hours: estimatedHours,
            estimated_watch_label: '',
          },
      top_genres: watchHidden ? [] : topGenres,
      by_format: watchHidden ? [] : byFormat,
      badges: watchHidden ? [] : badges,
      watched: {
        items: watchHidden ? [] : watchedItems,
        total: watchHidden ? 0 : rows.length,
        page: safePage,
        limit: safeLimit,
      },
      translator: translatorBlock,
    };
  }
}
