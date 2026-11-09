import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { isUuid } from '../../common/uuid.util';
import {
  Anime,
  AnimeComment,
  AnimeCommentLike,
  TelegramUser,
  UserAnimeAiringReminder,
  UserNotification,
  UserSocialFeedLike,
} from '../../entities';
import {
  SyncAiringRemindersDto,
  UpdateNotificationPreferencesDto,
} from './anime-notifications.dto';

@Injectable()
export class AnimeNotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeAiringReminder)
    private readonly remindersRepo: Repository<UserAnimeAiringReminder>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(UserSocialFeedLike)
    private readonly feedLikesRepo: Repository<UserSocialFeedLike>,
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(AnimeCommentLike)
    private readonly commentLikesRepo: Repository<AnimeCommentLike>,
  ) {}

  async list(telegramUserId: string, limit = 50, before?: string) {
    const take = Math.min(Math.max(limit, 1), 100);

    const qb = this.notificationsRepo
      .createQueryBuilder('n')
      .where('n.telegram_user_id = :telegramUserId', { telegramUserId })
      .orderBy('n.created_at', 'DESC')
      .take(take + 1);

    if (before) {
      qb.andWhere('n.created_at < :before', { before });
    }

    const rows = await qb.getMany();
    const hasMore = rows.length > take;
    if (hasMore) rows.pop();

    const animeIds = [
      ...new Set(
        rows
          .map((row) => row.animeId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const coverByAnimeId = new Map<string, string | null>();
    if (animeIds.length > 0) {
      const animes = await this.animeRepo.find({
        where: { id: In(animeIds) },
        select: { id: true, coverImage: true },
      });
      for (const anime of animes) {
        coverByAnimeId.set(anime.id, anime.coverImage ?? null);
      }
    }

    const actorIds = [
      ...new Set(
        rows
          .map((row) => this.actorIdOf(row))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const actorById = new Map<string, TelegramUser>();
    if (actorIds.length > 0) {
      const actors = await this.usersRepo.find({
        where: { telegramUserId: In(actorIds) },
      });
      for (const actor of actors) actorById.set(String(actor.telegramUserId), actor);
    }

    const linkedComments = await this.resolveCommentCards(rows);
    const activityKeys = [
      ...new Set(
        rows
          .map((row) => {
            if (linkedComments.has(row.id)) return '';
            return row.activityKey?.trim() || '';
          })
          .filter((key) => Boolean(key)),
      ),
    ];
    const commentIds = [
      ...new Set(
        [...linkedComments.values()].map((link) => link.commentId),
      ),
    ];
    const [feedLikes, commentLikes] = await Promise.all([
      this.loadFeedLikes(telegramUserId, activityKeys),
      this.loadCommentLikes(telegramUserId, commentIds),
    ]);
    const likedKeys = feedLikes.liked;
    const likeCountByKey = feedLikes.counts;
    const likedCommentIds = commentLikes.liked;
    const commentLikeCount = commentLikes.counts;

    return {
      items: rows.map((row) => {
        const actorId = this.actorIdOf(row);
        const actor = actorId ? actorById.get(actorId) : undefined;
        const linked = linkedComments.get(row.id);
        const commentId = linked?.commentId ?? null;
        const activityKey =
          row.activityKey?.trim() || (commentId ? `c:${commentId}` : null);
        const contentBody =
          row.contentBody?.trim() || linked?.body?.trim() || null;
        return {
          id: row.id,
          kind: row.kind,
          title: row.title,
          message: row.message,
          href: row.href,
          anime_id: row.animeId,
          anime_cover_image: row.animeId
            ? (coverByAnimeId.get(row.animeId) ?? null)
            : null,
          episode_number: row.episodeNumber,
          is_read: row.isRead,
          created_at: row.createdAt.toISOString(),
          actor_telegram_user_id: actorId,
          actor_photo_url: actor?.photoUrl ?? null,
          actor_display_name: actor ? this.displayNameOf(actor) : null,
          content_body: contentBody,
          activity_key: activityKey,
          comment_id: commentId,
          liked_by_me: commentId
            ? likedCommentIds.has(commentId)
            : activityKey
              ? likedKeys.has(activityKey)
              : false,
          like_count: commentId
            ? (commentLikeCount.get(commentId) ?? 0)
            : activityKey
              ? (likeCountByKey.get(activityKey) ?? 0)
              : 0,
        };
      }),
      has_more: hasMore,
      next_before: hasMore
        ? rows[rows.length - 1].createdAt.toISOString()
        : null,
    };
  }

  private actorIdOf(row: UserNotification): string | null {
    if (row.actorTelegramUserId) return String(row.actorTelegramUserId);
    const href = row.href?.trim() ?? '';
    const match = href.match(/^\/u\/([^/?#]+)/);
    if (!match) return null;
    if (
      row.kind === 'social_follow' ||
      row.kind === 'feed_activity_like' ||
      row.kind === 'feed_activity_note'
    ) {
      try {
        return decodeURIComponent(match[1]);
      } catch {
        return match[1];
      }
    }
    return null;
  }

  private displayNameOf(user: TelegramUser): string {
    const social = user.socialDisplayName?.trim();
    if (social) return social;
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return full || 'کاربر';
  }

  private commentIdOf(row: UserNotification): string | null {
    if (isUuid(row.commentId)) return row.commentId;
    const match = /^c:([0-9a-f-]{36})$/i.exec(row.activityKey?.trim() ?? '');
    return match && isUuid(match[1]) ? match[1] : null;
  }

  private isCommentKind(kind: string): boolean {
    return (
      kind === 'comment_reply' ||
      kind === 'following_comment' ||
      kind === 'comment_like'
    );
  }

  /** Attach the comment id and body, including older rows that never stored them. */
  private async resolveCommentCards(
    rows: UserNotification[],
  ): Promise<Map<string, { commentId: string; body: string | null }>> {
    const out = new Map<string, { commentId: string; body: string | null }>();
    const knownIds = [
      ...new Set(
        rows
          .map((row) => this.commentIdOf(row))
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const byId = new Map<string, AnimeComment>();
    if (knownIds.length > 0) {
      const found = await this.commentsRepo.find({ where: { id: In(knownIds) } });
      for (const comment of found) byId.set(comment.id, comment);
    }
    for (const row of rows) {
      const commentId = this.commentIdOf(row);
      if (!commentId) continue;
      out.set(row.id, {
        commentId,
        body: row.contentBody?.trim() || byId.get(commentId)?.body?.trim() || null,
      });
    }

    const legacy = rows.filter(
      (row) => !out.has(row.id) && this.isCommentKind(row.kind) && row.animeId,
    );
    if (legacy.length === 0) return out;

    const animeIds = [...new Set(legacy.map((row) => row.animeId as string))];
    const times = legacy.map((row) => row.createdAt.getTime());
    const min = new Date(Math.min(...times) - 5 * 60 * 1000);
    const max = new Date(Math.max(...times) + 5 * 60 * 1000);
    const comments = await this.commentsRepo
      .createQueryBuilder('c')
      .where('c.anime_id IN (:...animeIds)', { animeIds })
      .andWhere('c.is_deleted = false')
      .andWhere(
        '(c.created_at BETWEEN :min AND :max OR (c.moderated_at IS NOT NULL AND c.moderated_at BETWEEN :min AND :max))',
        { min, max },
      )
      .getMany();

    const anchorIds = [
      ...new Set(
        comments.flatMap((comment) =>
          [comment.parentId, comment.replyToCommentId].filter(
            (id): id is string => Boolean(id),
          ),
        ),
      ),
    ];
    const anchorAuthor = new Map<string, string>();
    if (anchorIds.length > 0) {
      const anchors = await this.commentsRepo.find({
        where: { id: In(anchorIds) },
      });
      for (const anchor of anchors) {
        anchorAuthor.set(anchor.id, String(anchor.telegramUserId));
      }
    }

    const distance = (comment: AnimeComment, target: number) => {
      const deltas = [Math.abs(comment.createdAt.getTime() - target)];
      if (comment.moderatedAt) {
        deltas.push(Math.abs(comment.moderatedAt.getTime() - target));
      }
      return Math.min(...deltas);
    };

    for (const row of legacy) {
      const recipient = String(row.telegramUserId);
      const actor = row.actorTelegramUserId
        ? String(row.actorTelegramUserId)
        : null;
      const target = row.createdAt.getTime();
      const pool = comments.filter(
        (comment) =>
          comment.animeId === row.animeId && distance(comment, target) <= 5 * 60 * 1000,
      );
      let candidates = pool;
      if (row.kind === 'comment_reply') {
        candidates = pool.filter((comment) => {
          if (actor && String(comment.telegramUserId) !== actor) return false;
          const parentAuthor = comment.parentId
            ? anchorAuthor.get(comment.parentId)
            : undefined;
          const replyAuthor = comment.replyToCommentId
            ? anchorAuthor.get(comment.replyToCommentId)
            : undefined;
          return parentAuthor === recipient || replyAuthor === recipient;
        });
      } else if (row.kind === 'following_comment') {
        candidates = pool.filter((comment) => {
          if (comment.parentId) return false;
          if (String(comment.telegramUserId) === recipient) return false;
          return !actor || String(comment.telegramUserId) === actor;
        });
      } else {
        candidates = pool.filter(
          (comment) => String(comment.telegramUserId) === recipient,
        );
      }
      candidates.sort(
        (a, b) => distance(a, target) - distance(b, target),
      );
      const pick = candidates[0];
      if (!pick) continue;
      out.set(row.id, {
        commentId: pick.id,
        body: pick.body?.trim() || null,
      });
    }

    return out;
  }

  private async loadFeedLikes(telegramUserId: string, activityKeys: string[]) {
    const liked = new Set<string>();
    const counts = new Map<string, number>();
    if (activityKeys.length === 0) return { liked, counts };
    const [mine, rows] = await Promise.all([
      this.feedLikesRepo.find({
        where: { telegramUserId, activityKey: In(activityKeys) },
      }),
      this.feedLikesRepo
        .createQueryBuilder('l')
        .select('l.activity_key', 'activity_key')
        .addSelect('COUNT(*)', 'count')
        .where('l.activity_key IN (:...activityKeys)', { activityKeys })
        .groupBy('l.activity_key')
        .getRawMany<{ activity_key: string; count: string }>(),
    ]);
    for (const row of mine) liked.add(row.activityKey);
    for (const row of rows) counts.set(row.activity_key, Number(row.count) || 0);
    return { liked, counts };
  }

  private async loadCommentLikes(telegramUserId: string, commentIds: string[]) {
    const liked = new Set<string>();
    const counts = new Map<string, number>();
    if (commentIds.length === 0) return { liked, counts };
    const [mine, rows] = await Promise.all([
      this.commentLikesRepo.find({
        where: { telegramUserId, commentId: In(commentIds) },
      }),
      this.commentLikesRepo
        .createQueryBuilder('l')
        .select('l.comment_id', 'comment_id')
        .addSelect('COUNT(*)', 'count')
        .where('l.comment_id IN (:...commentIds)', { commentIds })
        .groupBy('l.comment_id')
        .getRawMany<{ comment_id: string; count: string }>(),
    ]);
    for (const row of mine) liked.add(row.commentId);
    for (const row of rows) counts.set(row.comment_id, Number(row.count) || 0);
    return { liked, counts };
  }

  async unreadCount(telegramUserId: string) {
    const count = await this.notificationsRepo.count({
      where: { telegramUserId, isRead: false },
    });
    return { unread_count: count };
  }

  async markRead(telegramUserId: string, notificationId: string) {
    const row = await this.notificationsRepo.findOne({
      where: { id: notificationId, telegramUserId },
    });
    if (!row) throw new NotFoundException('Notification not found');
    row.isRead = true;
    await this.notificationsRepo.save(row);
    return { ok: true };
  }

  async markAllRead(telegramUserId: string) {
    await this.notificationsRepo.update(
      { telegramUserId, isRead: false },
      { isRead: true },
    );
    return { ok: true };
  }

  async getPreferences(telegramUserId: string) {
    const user = await this.usersRepo.findOne({ where: { telegramUserId } });
    return {
      notify_new_episode: user?.notifyNewEpisode !== false,
      notify_telegram_dm: user?.notifyTelegramDm !== false,
      notify_social_follow: user?.notifySocialFollow !== false,
      notify_comment_reply: user?.notifyCommentReply !== false,
      notify_comment_like: user?.notifyCommentLike !== false,
      notify_following_comment: user?.notifyFollowingComment !== false,
      notify_feed_activity_like: user?.notifyFeedActivityLike !== false,
      notify_feed_activity_note: user?.notifyFeedActivityNote !== false,
      hide_telegram_username: user?.hideTelegramUsername === true,
      hide_watch_activity: user?.hideWatchActivity === true,
    };
  }

  async updatePreferences(
    telegramUserId: string,
    body: UpdateNotificationPreferencesDto,
  ) {
    const user = await this.usersRepo.findOne({ where: { telegramUserId } });
    if (!user) throw new NotFoundException('User not found');

    if (body.notify_new_episode !== undefined) {
      user.notifyNewEpisode = body.notify_new_episode;
    }
    if (body.notify_telegram_dm !== undefined) {
      user.notifyTelegramDm = body.notify_telegram_dm;
    }
    if (body.notify_social_follow !== undefined) {
      user.notifySocialFollow = body.notify_social_follow;
    }
    if (body.notify_comment_reply !== undefined) {
      user.notifyCommentReply = body.notify_comment_reply;
    }
    if (body.notify_comment_like !== undefined) {
      user.notifyCommentLike = body.notify_comment_like;
    }
    if (body.notify_following_comment !== undefined) {
      user.notifyFollowingComment = body.notify_following_comment;
    }
    if (body.notify_feed_activity_like !== undefined) {
      user.notifyFeedActivityLike = body.notify_feed_activity_like;
    }
    if (body.notify_feed_activity_note !== undefined) {
      user.notifyFeedActivityNote = body.notify_feed_activity_note;
    }
    if (body.hide_telegram_username !== undefined) {
      user.hideTelegramUsername = body.hide_telegram_username;
    }
    if (body.hide_watch_activity !== undefined) {
      user.hideWatchActivity = body.hide_watch_activity;
    }

    await this.usersRepo.save(user);
    return {
      notify_new_episode: user.notifyNewEpisode,
      notify_telegram_dm: user.notifyTelegramDm,
      notify_social_follow: user.notifySocialFollow !== false,
      notify_comment_reply: user.notifyCommentReply !== false,
      notify_comment_like: user.notifyCommentLike !== false,
      notify_following_comment: user.notifyFollowingComment !== false,
      notify_feed_activity_like: user.notifyFeedActivityLike !== false,
      notify_feed_activity_note: user.notifyFeedActivityNote !== false,
      hide_telegram_username: user.hideTelegramUsername === true,
      hide_watch_activity: user.hideWatchActivity === true,
    };
  }

  async listAiringReminders(telegramUserId: string) {
    const rows = await this.remindersRepo.find({
      where: { telegramUserId },
      order: { createdAt: 'DESC' },
    });
    return { anime_ids: rows.map((r) => r.animeId) };
  }

  async enableAiringReminder(telegramUserId: string, animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeId(animeIdOrSlug);
    const existing = await this.remindersRepo.findOne({
      where: { telegramUserId, animeId },
    });
    if (!existing) {
      await this.remindersRepo.save(
        this.remindersRepo.create({ telegramUserId, animeId }),
      );
    }
    return { ok: true, anime_id: animeId, enabled: true };
  }

  async disableAiringReminder(telegramUserId: string, animeIdOrSlug: string) {
    const animeId = await this.resolveAnimeId(animeIdOrSlug);
    await this.remindersRepo.delete({ telegramUserId, animeId });
    return { ok: true, anime_id: animeId, enabled: false };
  }

  /** One-shot migrate from device localStorage ids. */
  async syncAiringReminders(
    telegramUserId: string,
    body: SyncAiringRemindersDto,
  ) {
    const ids = [
      ...new Set(
        (body.anime_ids ?? [])
          .map((id) => String(id).trim())
          .filter((id) => isUuid(id)),
      ),
    ];
    if (ids.length === 0) {
      return this.listAiringReminders(telegramUserId);
    }

    const existingAnime = await this.animeRepo.find({
      where: { id: In(ids) },
      select: { id: true },
    });
    const validIds = existingAnime.map((a) => a.id);
    if (validIds.length === 0) {
      return this.listAiringReminders(telegramUserId);
    }

    const already = await this.remindersRepo.find({
      where: { telegramUserId, animeId: In(validIds) },
      select: { animeId: true },
    });
    const alreadySet = new Set(already.map((r) => r.animeId));
    const toInsert = validIds.filter((id) => !alreadySet.has(id));
    if (toInsert.length > 0) {
      await this.remindersRepo.insert(
        toInsert.map((animeId) => ({ telegramUserId, animeId })),
      );
    }

    return this.listAiringReminders(telegramUserId);
  }

  private async resolveAnimeId(animeIdOrSlug: string): Promise<string> {
    const raw = String(animeIdOrSlug ?? '').trim();
    if (!raw) throw new BadRequestException('anime id required');
    if (isUuid(raw)) {
      const byId = await this.animeRepo.findOne({
        where: { id: raw },
        select: { id: true },
      });
      if (!byId) throw new NotFoundException('Anime not found');
      return byId.id;
    }
    const bySlug = await this.animeRepo.findOne({
      where: { slug: raw },
      select: { id: true },
    });
    if (!bySlug) throw new NotFoundException('Anime not found');
    return bySlug.id;
  }
}
