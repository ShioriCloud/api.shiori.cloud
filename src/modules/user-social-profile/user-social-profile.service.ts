import {
  BadRequestException,
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
  UserSocialFeedLike,
  UserSocialFeedNote,
  UserSocialFollow,
} from '../../entities';
import type { DownloadTokenWalletMode } from '../download-tokens/download-token-wallet.util';
import {
  isSocialProfileEnabledFor,
  SOCIAL_PROFILE_RESPONSE_MODE,
} from './social-profile-rollout.util';

import { SOCIAL_BADGE_TOTAL_COUNT } from './social-badge-catalog';
import {
  SocialBadgeEngineService,
  type SocialBadgeCatalogResponse,
  type SocialBadgePublicResponse,
} from './social-badge-engine.service';
import { SocialNotificationDeliveryService } from './social-notification-delivery.service';
import { UserSocialModerationService } from './user-social-moderation.service';
import { minutesForWatched, normalizeProfileFormat } from './watch-time.util';

export type SocialProfileWatchedItem = {
  anime_id: string;
  slug: string | null;
  title: string;
  image: string;
  episodes_watched: number;
  episodes_total: number | null;
  user_rating: number | null;
  is_favorite: boolean;
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
  by_format?: Array<{
    format: string;
    count: number;
    episodes_watched: number;
  }>;
  badges?: Array<{
    id: string;
    title: string;
    image_url?: string | null;
    rarity?: string;
    is_new?: boolean;
  }>;
  badges_summary?: { earned_count: number; total_count: number };
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
      start_date: string | null;
      year: number | null;
      /** AniList averageScore, 0–100. */
      anilist_score: number | null;
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
  /** Whether the authenticated viewer follows this user (list endpoints). */
  is_following?: boolean;
  /** Whether this user follows the authenticated viewer (list endpoints). */
  follows_you?: boolean;
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

export type SocialFeedVisibleNote = {
  telegram_user_id: string;
  display_name: string;
  photo_url: string | null;
  body: string;
  created_at: string;
  is_private: boolean;
};

export type SocialFeedEngagement = {
  activity_key: string;
  like_count: number;
  liked_by_me: boolean;
  my_note: string | null;
  my_note_is_private: boolean;
  /** Notes the viewer may see: all public, plus private if viewer is author or activity owner. */
  notes: SocialFeedVisibleNote[];
  /** @deprecated Prefer `notes`; kept for older clients as public-only subset. */
  public_notes: SocialFeedVisibleNote[];
};

export type SocialProfileFeedItemWithEngagement = SocialProfileFeedItem & {
  engagement: SocialFeedEngagement;
};

export type SocialProfileFeedResponse = {
  enabled: boolean;
  mode: DownloadTokenWalletMode;
  items: SocialProfileFeedItemWithEngagement[];
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
    private readonly badgeEngine: SocialBadgeEngineService,
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(UserCustomList)
    private readonly customListRepo: Repository<UserCustomList>,
    @InjectRepository(UserCustomListItem)
    private readonly customListItemRepo: Repository<UserCustomListItem>,
    private readonly socialNotifications: SocialNotificationDeliveryService,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeTranslator)
    private readonly translatorRepo: Repository<AnimeTranslator>,
    @InjectRepository(AnimeTranslatorLink)
    private readonly translatorLinkRepo: Repository<AnimeTranslatorLink>,
    @InjectRepository(UserSocialFeedLike)
    private readonly feedLikeRepo: Repository<UserSocialFeedLike>,
    @InjectRepository(UserSocialFeedNote)
    private readonly feedNoteRepo: Repository<UserSocialFeedNote>,
  ) {}

  feedActivityKey(item: SocialProfileFeedItem): string {
    if (item.type === 'anime_comment') return `c:${item.comment_id}`;
    if (item.type === 'user_follow') {
      return `f:${item.actor.telegram_user_id}:${item.target.telegram_user_id}`;
    }
    if (item.type === 'public_list_add') {
      return `pl:${item.list_id}:${item.anime_id}`;
    }
    return `${item.type}:${item.actor.telegram_user_id}:${item.anime_id}`;
  }

  private async resolveFeedActivityOwner(
    activityKey: string,
  ): Promise<string | null> {
    const key = String(activityKey ?? '').trim();
    if (!key) return null;
    if (key.startsWith('c:')) {
      const commentId = key.slice(2);
      const comment = await this.commentsRepo.findOne({
        where: { id: commentId },
        select: { telegramUserId: true },
      });
      return comment ? String(comment.telegramUserId) : null;
    }
    if (key.startsWith('f:')) {
      const actorId = key.split(':')[1];
      return actorId ? String(actorId) : null;
    }
    if (key.startsWith('pl:')) {
      const listId = key.slice(3).split(':')[0];
      if (!listId) return null;
      const list = await this.customListRepo.findOne({
        where: { id: listId },
        select: { telegramUserId: true },
      });
      return list ? String(list.telegramUserId) : null;
    }
    const parts = key.split(':');
    if (parts.length >= 3 && parts[1]) return String(parts[1]);
    return null;
  }

  private noteVisibleToViewer(
    note: UserSocialFeedNote,
    viewerId: string,
    activityOwnerId: string | null,
  ): boolean {
    if (!note.isPrivate) return true;
    const authorId = String(note.telegramUserId);
    if (authorId === viewerId) return true;
    if (activityOwnerId && activityOwnerId === viewerId) return true;
    return false;
  }

  private async engagementForViewer(
    viewerId: string,
    activityKey: string,
  ): Promise<SocialFeedEngagement> {
    const [count, likedRow, allNotes, ownerId] = await Promise.all([
      this.feedLikeRepo.count({ where: { activityKey } }),
      this.feedLikeRepo.findOne({
        where: { telegramUserId: viewerId, activityKey },
        select: { activityKey: true },
      }),
      this.feedNoteRepo.find({
        where: { activityKey },
        order: { createdAt: 'ASC' },
      }),
      this.resolveFeedActivityOwner(activityKey),
    ]);
    const visibleNotes = allNotes.filter((n) =>
      this.noteVisibleToViewer(n, viewerId, ownerId),
    );
    return this.mapNotesToEngagement(
      viewerId,
      activityKey,
      count,
      Boolean(likedRow),
      visibleNotes,
    );
  }

  private async mapNotesToEngagement(
    viewerId: string,
    activityKey: string,
    likeCount: number,
    likedByMe: boolean,
    notes: UserSocialFeedNote[],
  ): Promise<SocialFeedEngagement> {
    const myNote = notes.find((n) => String(n.telegramUserId) === viewerId);
    const authorIds = [
      ...new Set(notes.map((n) => String(n.telegramUserId))),
    ];
    const authors =
      authorIds.length > 0
        ? await this.usersRepo.find({
            where: { telegramUserId: In(authorIds) },
          })
        : [];
    const authorById = new Map(
      authors.map((u) => [String(u.telegramUserId), u]),
    );
    const mapped: SocialFeedVisibleNote[] = notes.map((n) => {
      const author = authorById.get(String(n.telegramUserId));
      return {
        telegram_user_id: String(n.telegramUserId),
        display_name: author ? this.displayNameOf(author) : 'کاربر',
        photo_url: author?.photoUrl ?? null,
        body: n.body,
        created_at: n.createdAt.toISOString(),
        is_private: n.isPrivate === true,
      };
    });
    return {
      activity_key: activityKey,
      like_count: likeCount,
      liked_by_me: likedByMe,
      my_note: myNote?.body ?? null,
      my_note_is_private: myNote?.isPrivate ?? false,
      notes: mapped,
      public_notes: mapped.filter((n) => !n.is_private),
    };
  }

  private async attachFeedEngagement(
    viewerId: string,
    items: SocialProfileFeedItem[],
  ): Promise<SocialProfileFeedItemWithEngagement[]> {
    if (items.length === 0) return [];
    const keys = items.map((item) => this.feedActivityKey(item));
    const ownerByKey = new Map(
      items.map((item) => [
        this.feedActivityKey(item),
        String(item.actor.telegram_user_id),
      ]),
    );
    const [likeRows, myLikes, allNotes] = await Promise.all([
      this.feedLikeRepo
        .createQueryBuilder('l')
        .select('l.activity_key', 'activity_key')
        .addSelect('COUNT(*)', 'cnt')
        .where('l.activity_key IN (:...keys)', { keys })
        .groupBy('l.activity_key')
        .getRawMany<{ activity_key: string; cnt: string }>(),
      this.feedLikeRepo.find({
        where: { telegramUserId: viewerId, activityKey: In(keys) },
        select: { activityKey: true },
      }),
      this.feedNoteRepo.find({
        where: { activityKey: In(keys) },
        order: { createdAt: 'ASC' },
      }),
    ]);
    const countByKey = new Map(
      likeRows.map((r) => [r.activity_key, Number(r.cnt ?? 0)]),
    );
    const likedSet = new Set(myLikes.map((r) => r.activityKey));
    const visibleNotes = allNotes.filter((n) =>
      this.noteVisibleToViewer(
        n,
        viewerId,
        ownerByKey.get(n.activityKey) ?? null,
      ),
    );
    const notesByKey = new Map<string, UserSocialFeedNote[]>();
    for (const note of visibleNotes) {
      const list = notesByKey.get(note.activityKey) ?? [];
      list.push(note);
      notesByKey.set(note.activityKey, list);
    }
    const authorIds = [
      ...new Set(visibleNotes.map((n) => String(n.telegramUserId))),
    ];
    const authors =
      authorIds.length > 0
        ? await this.usersRepo.find({
            where: { telegramUserId: In(authorIds) },
          })
        : [];
    const authorById = new Map(
      authors.map((u) => [String(u.telegramUserId), u]),
    );

    return items.map((item) => {
      const activity_key = this.feedActivityKey(item);
      const notes = notesByKey.get(activity_key) ?? [];
      const myNote = notes.find((n) => String(n.telegramUserId) === viewerId);
      const mapped: SocialFeedVisibleNote[] = notes.map((n) => {
        const author = authorById.get(String(n.telegramUserId));
        return {
          telegram_user_id: String(n.telegramUserId),
          display_name: author ? this.displayNameOf(author) : 'کاربر',
          photo_url: author?.photoUrl ?? null,
          body: n.body,
          created_at: n.createdAt.toISOString(),
          is_private: n.isPrivate === true,
        };
      });
      return {
        ...item,
        engagement: {
          activity_key,
          like_count: countByKey.get(activity_key) ?? 0,
          liked_by_me: likedSet.has(activity_key),
          my_note: myNote?.body ?? null,
          my_note_is_private: myNote?.isPrivate ?? false,
          notes: mapped,
          public_notes: mapped.filter((n) => !n.is_private),
        },
      };
    });
  }

  async toggleFeedLike(
    telegramUserId: string,
    activityKey: string,
    activityType?: string,
  ): Promise<SocialFeedEngagement> {
    this.assertSocialEnabled();
    const userId = String(telegramUserId);
    const key = String(activityKey ?? '').trim().slice(0, 240);
    if (!key) throw new BadRequestException('activity_key required');
    const existing = await this.feedLikeRepo.findOne({
      where: { telegramUserId: userId, activityKey: key },
    });
    if (existing) {
      await this.feedLikeRepo.delete({ telegramUserId: userId, activityKey: key });
    } else {
      await this.feedLikeRepo.save(
        this.feedLikeRepo.create({
          telegramUserId: userId,
          activityKey: key,
          activityType: activityType?.trim() || null,
        }),
      );
      const ownerId = await this.resolveFeedActivityOwner(key);
      if (ownerId && ownerId !== userId) {
        const blocked = await this.moderation.arePeersBlocked(ownerId, userId);
        if (!blocked) {
          const liker = await this.usersRepo.findOne({
            where: { telegramUserId: userId },
          });
          const name = liker ? this.displayNameOf(liker) : 'یک کاربر';
          await this.socialNotifications.deliver({
            recipientTelegramUserId: ownerId,
            kind: 'feed_activity_like',
            title: 'پسند روی فعالیتت',
            message: `کاربر ${name} فعالیتت را پسندید`,
            href: `/u/${encodeURIComponent(userId)}`,
          });
        }
      }
    }
    return this.engagementForViewer(userId, key);
  }

  async upsertFeedNote(
    telegramUserId: string,
    activityKey: string,
    body: string,
    isPrivate = false,
  ): Promise<SocialFeedEngagement> {
    this.assertSocialEnabled();
    const userId = String(telegramUserId);
    const key = String(activityKey ?? '').trim().slice(0, 240);
    const text = String(body ?? '').trim().slice(0, 280);
    const privateNote = Boolean(isPrivate);
    if (!key) throw new BadRequestException('activity_key required');
    if (!text) throw new BadRequestException('note body required');
    const existing = await this.feedNoteRepo.findOne({
      where: { telegramUserId: userId, activityKey: key },
    });
    const wasPrivate = existing?.isPrivate !== false;
    if (existing) {
      existing.body = text;
      existing.isPrivate = privateNote;
      await this.feedNoteRepo.save(existing);
    } else {
      await this.feedNoteRepo.save(
        this.feedNoteRepo.create({
          telegramUserId: userId,
          activityKey: key,
          body: text,
          isPrivate: privateNote,
        }),
      );
    }
    // Notify activity owner on first note, or when a private note becomes public.
    const shouldNotify = !existing || (wasPrivate && !privateNote);
    if (shouldNotify) {
      const ownerId = await this.resolveFeedActivityOwner(key);
      if (ownerId && ownerId !== userId) {
        const blocked = await this.moderation.arePeersBlocked(ownerId, userId);
        if (!blocked) {
          const author = await this.usersRepo.findOne({
            where: { telegramUserId: userId },
          });
          const name = author ? this.displayNameOf(author) : 'یک کاربر';
          const preview =
            text.length > 80 ? `${text.slice(0, 79)}…` : text;
          await this.socialNotifications.deliver({
            recipientTelegramUserId: ownerId,
            kind: 'feed_activity_note',
            title: privateNote
              ? 'یادداشت خصوصی روی فعالیتت'
              : 'یادداشت روی فعالیتت',
            message: `کاربر ${name}: ${preview}`,
            href: `/u/${encodeURIComponent(userId)}`,
          });
        }
      }
    }
    return this.engagementForViewer(userId, key);
  }

  async deleteFeedNote(
    telegramUserId: string,
    activityKey: string,
  ): Promise<SocialFeedEngagement> {
    this.assertSocialEnabled();
    const userId = String(telegramUserId);
    const key = String(activityKey ?? '').trim().slice(0, 240);
    if (!key) throw new BadRequestException('activity_key required');
    await this.feedNoteRepo.delete({ telegramUserId: userId, activityKey: key });
    return this.engagementForViewer(userId, key);
  }

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

  async getMyBadgeCatalog(
    telegramUserId: string,
  ): Promise<SocialBadgeCatalogResponse> {
    this.assertSocialEnabled();
    const userId = String(telegramUserId);
    if (!this.isEnabledFor(userId)) {
      return {
        enabled: false,
        earned_count: 0,
        total_count: SOCIAL_BADGE_TOTAL_COUNT,
        showcase: [],
        categories: [],
      };
    }
    const { catalog } = await this.badgeEngine.getMyCatalog(userId);
    return catalog;
  }

  async updateBadgeShowcase(
    telegramUserId: string,
    badgeIds: string[],
  ): Promise<{ showcase: string[] }> {
    this.assertSocialEnabled();
    const userId = String(telegramUserId);
    if (!this.isEnabledFor(userId)) {
      throw new BadRequestException('Social profile not enabled');
    }
    const showcase = await this.badgeEngine.updateShowcase(userId, badgeIds);
    return { showcase };
  }

  async getUserBadgeDisplay(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
  ): Promise<SocialBadgePublicResponse> {
    this.assertSocialEnabled();
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    if (!this.isEnabledFor(viewerId)) {
      return {
        enabled: false,
        earned_count: 0,
        total_count: SOCIAL_BADGE_TOTAL_COUNT,
        display_name: '',
        showcase: [],
        badges: [],
      };
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!user) {
      throw new NotFoundException('User not found');
    }

    const isSelf = viewerId === targetId;
    const watchHidden = !isSelf && user.hideWatchActivity === true;
    const displayName = this.displayNameOf(user);

    if (watchHidden) {
      return {
        enabled: true,
        earned_count: 0,
        total_count: SOCIAL_BADGE_TOTAL_COUNT,
        display_name: displayName,
        showcase: [],
        badges: [],
      };
    }

    return this.badgeEngine.getPublicDisplay(targetId, displayName);
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
    this.assertSocialEnabled();
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

  private animeReleaseSortKey(anime?: Anime | null): number {
    if (!anime) return 0;
    if (anime.startDate) {
      const t = Date.parse(anime.startDate);
      if (!Number.isNaN(t)) return t;
    }
    if (anime.lastEpisodeAt) {
      return anime.lastEpisodeAt.getTime();
    }
    if (anime.year != null && anime.year > 0) {
      return anime.year * 10000 + 601;
    }
    if (anime.createdAt) {
      return anime.createdAt.getTime();
    }
    return 0;
  }

  private sortTranslatorLinksByRelease(
    links: AnimeTranslatorLink[],
  ): AnimeTranslatorLink[] {
    return [...links].sort(
      (a, b) =>
        this.animeReleaseSortKey(b.anime) - this.animeReleaseSortKey(a.anime) ||
        a.animeId.localeCompare(b.animeId),
    );
  }

  private mode(): DownloadTokenWalletMode {
    return SOCIAL_PROFILE_RESPONSE_MODE;
  }

  isEnabledFor(telegramUserId: string): boolean {
    return isSocialProfileEnabledFor(telegramUserId);
  }

  private assertSocialEnabled(): void {
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
    this.assertSocialEnabled();
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

      const follower = await this.usersRepo.findOne({
        where: { telegramUserId: viewerId },
      });
      const followerName = follower ? this.displayNameOf(follower) : 'یک کاربر';
      await this.socialNotifications.deliver({
        recipientTelegramUserId: targetId,
        kind: 'social_follow',
        title: 'دنبال‌کننده جدید',
        message: `کاربر ${followerName} دنبالت کرد`,
        href: `/u/${encodeURIComponent(viewerId)}`,
      });
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
      (u) =>
        !blocked.has(String(u.telegramUserId)) &&
        String(u.telegramUserId) !== viewerId,
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
    this.assertSocialEnabled();
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

  async unblockUser(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
  ) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled();
    await this.moderation.unblockUser(viewerId, targetId);
    return { ok: true as const, is_blocked: false };
  }

  async muteUser(viewerTelegramUserId: string, targetTelegramUserId: string) {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    this.assertSocialEnabled();
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
    this.assertSocialEnabled();
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
    this.assertSocialEnabled();
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

    const mergeNeed = safePage * safeLimit;
    const sourceCap = Math.min(600, mergeNeed + safeLimit * 2);

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
    const bareItems: SocialProfileFeedItem[] = staged
      .slice(skip, skip + safeLimit)
      .map((row) => {
        const { sortTs, ...item } = row;
        void sortTs;
        return item;
      });
    const items = await this.attachFeedEngagement(viewerId, bareItems);

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

    let followingSet = new Set<string>();
    let followsYouSet = new Set<string>();
    if (filteredIds.length > 0) {
      const followingRows = await this.followRepo.find({
        where: {
          followerTelegramUserId: viewerId,
          followingTelegramUserId: In(filteredIds),
        },
        select: { followingTelegramUserId: true },
      });
      followingSet = new Set(
        followingRows.map((r) => String(r.followingTelegramUserId)),
      );
      const followsViewerRows = await this.followRepo.find({
        where: {
          followerTelegramUserId: In(filteredIds),
          followingTelegramUserId: viewerId,
        },
        select: { followerTelegramUserId: true },
      });
      followsYouSet = new Set(
        followsViewerRows.map((r) => String(r.followerTelegramUserId)),
      );
    }

    return {
      enabled: true,
      mode,
      items: items.map((item) => ({
        ...item,
        is_following: followingSet.has(item.telegram_user_id),
        follows_you: followsYouSet.has(item.telegram_user_id),
      })),
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
        return this.toProfileListUser(user, translatorByUserId.get(id) ?? null);
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
  ): Promise<
    Omit<
      SocialProfileMeResponse,
      'enabled' | 'mode' | 'is_self' | 'telegram_user_id'
    >
  > {
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
        r.userRating != null && r.userRating !== ''
          ? Number(r.userRating)
          : null,
      )
      .filter((v): v is number => v != null && Number.isFinite(v));

    const episodesWatched = rows.reduce(
      (sum, r) => sum + (r.episodesWatched ?? 0),
      0,
    );
    const activeDayKeys = new Set(
      rows.map((r) => r.updatedAt.toISOString().slice(0, 10)),
    );
    const estimatedMinutes = rows.reduce((sum, row) => {
      const anime = animeById.get(row.animeId);
      return sum + minutesForWatched(anime?.format, row.episodesWatched ?? 0);
    }, 0);
    const estimatedHours = Math.round(estimatedMinutes / 60);

    const genreCounts = new Map<
      string,
      { slug: string; label: string; count: number }
    >();
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

    const genreTotal = [...genreCounts.values()].reduce(
      (s, g) => s + g.count,
      0,
    );
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

    const badgeState = await this.badgeEngine.syncForProfile(targetId);
    const badges = badgeState.chips;

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
        is_favorite: row.isFavorite !== false,
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
      const links = this.sortTranslatorLinksByRelease(
        await this.translatorLinkRepo.find({
          where: { translatorId: linkedTranslator.id },
          relations: { anime: true },
        }),
      );
      translatorBlock = {
        id: linkedTranslator.id,
        slug: linkedTranslator.slug,
        name: linkedTranslator.name,
        bio: linkedTranslator.bio,
        experience: linkedTranslator.experience,
        is_active: linkedTranslator.isActive !== false,
        anime_count: links.length,
        anime: links.map((link) => {
          const rawScore = link.anime?.averageScore;
          const parsed =
            rawScore == null || rawScore === '' ? NaN : Number(rawScore);
          return {
            anime_id: link.animeId,
            slug: link.anime?.slug ?? null,
            title: link.anime?.title ?? '—',
            image: link.anime?.coverImage || link.anime?.featuredImage || '',
            role: link.role,
            start_date: link.anime?.startDate ?? null,
            year: link.anime?.year ?? null,
            anilist_score: Number.isFinite(parsed) ? parsed : null,
          };
        }),
      };
    }

    let relationship: SocialProfileMeResponse['relationship'];
    const viewerId = viewerTelegramUserId?.trim();
    if (viewerId && viewerId !== targetId) {
      const [isFollowing, followsYou, isMuted, blockedByYou] =
        await Promise.all([
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
    const watchHidden = !isSelf && user?.hideWatchActivity === true;

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
      badges_summary: watchHidden
        ? undefined
        : {
            earned_count: badgeState.earned_count,
            total_count: SOCIAL_BADGE_TOTAL_COUNT,
          },
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
