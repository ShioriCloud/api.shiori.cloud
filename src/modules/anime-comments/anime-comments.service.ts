import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, IsNull, Repository } from 'typeorm';
import {
  Anime,
  AnimeComment,
  AnimeCommentLike,
  AnimeCommentReport,
  TelegramUser,
  UserSocialFollow,
} from '../../entities';
import { SocialNotificationDeliveryService } from '../user-social-profile/social-notification-delivery.service';
import { UserSocialModerationService } from '../user-social-profile/user-social-moderation.service';
import { isSocialProfileEnabledFor } from '../user-social-profile/social-profile-rollout.util';

const MAX_BODY = 1000;
const FOLLOWER_COMMENT_NOTIFY_CAP = 200;

export type AnimeCommentAuthorDto = {
  telegram_user_id: string;
  display_name: string;
  username: string | null;
  photo_url: string | null;
};

export type AnimeCommentDto = {
  id: string;
  anime_id: string;
  parent_id: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  is_own: boolean;
  author: AnimeCommentAuthorDto;
  reply_count: number;
  like_count: number;
  liked_by_me: boolean;
  reply_to: {
    comment_id: string;
    author: AnimeCommentAuthorDto;
  } | null;
};

@Injectable()
export class AnimeCommentsService {
  private readonly logger = new Logger(AnimeCommentsService.name);

  constructor(
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(AnimeCommentLike)
    private readonly likesRepo: Repository<AnimeCommentLike>,
    @InjectRepository(AnimeCommentReport)
    private readonly reportsRepo: Repository<AnimeCommentReport>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserSocialFollow)
    private readonly followRepo: Repository<UserSocialFollow>,
    private readonly socialNotifications: SocialNotificationDeliveryService,
    private readonly moderation: UserSocialModerationService,
  ) {}

  private displayNameOf(user: TelegramUser): string {
    return (
      user.socialDisplayName?.trim() ||
      user.firstName?.trim() ||
      user.username?.trim() ||
      'یک کاربر'
    );
  }

  access(telegramUserId: string): { enabled: boolean } {
    return { enabled: isSocialProfileEnabledFor(telegramUserId) };
  }

  private assertEnabled(): void {
    /* social / comments always enabled for authenticated users */
  }

  private cleanBody(raw: string): string {
    const body = String(raw ?? '')
      .replace(/\r\n/g, '\n')
      .trim();
    if (!body) throw new BadRequestException('comment body required');
    if (body.length > MAX_BODY) {
      throw new BadRequestException(`comment body too long (max ${MAX_BODY})`);
    }
    return body;
  }

  private async resolveAnimeId(raw: string): Promise<Anime> {
    const value = String(raw ?? '').trim();
    if (!value) throw new BadRequestException('anime_id required');
    const looksLikeUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
        value,
      );
    if (looksLikeUuid) {
      const byId = await this.animeRepo.findOne({ where: { id: value } });
      if (byId) return byId;
    }
    const bySlug = await this.animeRepo.findOne({ where: { slug: value } });
    if (bySlug) return bySlug;
    throw new NotFoundException('Anime not found');
  }

  async list(
    viewerId: string,
    animeKey: string,
    parentId?: string | null,
    page = 1,
    limit = 20,
  ) {
    this.assertEnabled();
    const anime = await this.resolveAnimeId(animeKey);
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));
    const parent = parentId?.trim() || null;

    const where = parent
      ? { animeId: anime.id, parentId: parent }
      : { animeId: anime.id, parentId: IsNull() };

    const [rows, total] = await this.commentsRepo.findAndCount({
      where,
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const items = await this.hydrate(rows, viewerId);
    return { items, total, page: safePage, limit: safeLimit };
  }

  async listMine(viewerId: string, page = 1, limit = 20) {
    return this.listByUser(viewerId, viewerId, page, limit);
  }

  async listByUser(
    viewerId: string,
    targetTelegramUserId: string,
    page = 1,
    limit = 20,
  ) {
    this.assertEnabled();
    const targetId = String(targetTelegramUserId).trim();
    if (!targetId) {
      throw new BadRequestException('user id required');
    }
    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const safePage = Math.max(1, page);
    const safeLimit = Math.min(50, Math.max(1, limit));

    const [rows, total] = await this.commentsRepo.findAndCount({
      where: { telegramUserId: targetId, isDeleted: false },
      order: { createdAt: 'DESC' },
      skip: (safePage - 1) * safeLimit,
      take: safeLimit,
    });

    const comments = await this.hydrate(rows, viewerId);
    const animeIds = [...new Set(rows.map((r) => r.animeId))];
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({ where: { id: In(animeIds) } })
        : [];
    const animeById = new Map(animes.map((a) => [a.id, a]));

    return {
      items: comments.map((comment) => {
        const anime = animeById.get(comment.anime_id);
        return {
          ...comment,
          anime: anime
            ? {
                id: anime.id,
                slug: anime.slug ?? null,
                title: anime.title ?? '—',
                image: anime.coverImage || anime.featuredImage || '',
              }
            : null,
        };
      }),
      total,
      page: safePage,
      limit: safeLimit,
    };
  }

  private async resolveReplyThread(
    animeId: string,
    input: { parent_id?: string; reply_to_comment_id?: string },
  ): Promise<{ rootId: string | null; replyToId: string | null }> {
    let rootId: string | null = null;
    let replyToId = input.reply_to_comment_id?.trim() || null;

    if (input.parent_id?.trim()) {
      const anchor = await this.commentsRepo.findOne({
        where: { id: input.parent_id.trim(), animeId },
      });
      if (!anchor || anchor.isDeleted) {
        throw new NotFoundException('Parent comment not found');
      }
      rootId = anchor.parentId ?? anchor.id;
      if (anchor.parentId && !replyToId) {
        replyToId = anchor.id;
      }
    }

    if (replyToId) {
      const target = await this.commentsRepo.findOne({
        where: { id: replyToId, animeId },
      });
      if (!target || target.isDeleted) {
        throw new NotFoundException('Reply target not found');
      }
      const targetRoot = target.parentId ?? target.id;
      if (!rootId) {
        rootId = targetRoot;
      } else if (targetRoot !== rootId) {
        throw new BadRequestException(
          'reply target must be in the same thread',
        );
      }
      replyToId = target.id;
    }

    if (replyToId && !rootId) {
      throw new BadRequestException('invalid reply thread');
    }

    return { rootId, replyToId };
  }

  private async notifyFollowersOfRootComment(
    authorId: string,
    anime: Anime,
    authorName: string,
  ): Promise<void> {
    const edges = await this.followRepo.find({
      where: { followingTelegramUserId: authorId },
      order: { createdAt: 'DESC' },
      take: FOLLOWER_COMMENT_NOTIFY_CAP,
    });
    if (edges.length === 0) return;

    const href = `/anime/${encodeURIComponent(anime.slug || anime.id)}?tab=comments`;
    const animeTitle = anime.title ?? 'انیمه';

    await Promise.all(
      edges.map(async (edge) => {
        const followerId = String(edge.followerTelegramUserId);
        if (followerId === authorId) return;
        if (await this.moderation.arePeersBlocked(followerId, authorId)) return;
        await this.socialNotifications.deliver({
          recipientTelegramUserId: followerId,
          kind: 'following_comment',
          title: 'نظر از دنبال‌شده',
          message: `${authorName} روی «${animeTitle}» نظر گذاشت`,
          href,
          animeId: anime.id,
        });
      }),
    );
  }

  async create(
    viewerId: string,
    input: {
      anime_id: string;
      body: string;
      parent_id?: string;
      reply_to_comment_id?: string;
    },
  ) {
    this.assertEnabled();
    const anime = await this.resolveAnimeId(input.anime_id);
    const body = this.cleanBody(input.body);
    const { rootId, replyToId } = await this.resolveReplyThread(
      anime.id,
      input,
    );

    const saved = await this.commentsRepo.save({
      animeId: anime.id,
      parentId: rootId,
      replyToCommentId: replyToId,
      telegramUserId: viewerId,
      body,
      isDeleted: false,
    });

    const author = await this.usersRepo.findOne({
      where: { telegramUserId: viewerId },
    });
    const name = author ? this.displayNameOf(author) : 'یک کاربر';
    const href = `/anime/${encodeURIComponent(anime.slug || anime.id)}?tab=comments`;

    if (rootId) {
      const root = await this.commentsRepo.findOne({ where: { id: rootId } });
      const rootAuthorId = root ? String(root.telegramUserId) : '';
      if (root && rootAuthorId !== viewerId) {
        const blocked = await this.moderation.arePeersBlocked(
          rootAuthorId,
          viewerId,
        );
        if (!blocked) {
          await this.socialNotifications.deliver({
            recipientTelegramUserId: rootAuthorId,
            kind: 'comment_reply',
            title: 'پاسخ به نظرت',
            message: `${name} به نظرت پاسخ داد`,
            href,
            animeId: anime.id,
          });
        }
      }

      if (replyToId && replyToId !== rootId) {
        const target = await this.commentsRepo.findOne({
          where: { id: replyToId },
        });
        const targetAuthorId = target ? String(target.telegramUserId) : '';
        if (
          target &&
          targetAuthorId !== viewerId &&
          targetAuthorId !== rootAuthorId
        ) {
          const blocked = await this.moderation.arePeersBlocked(
            targetAuthorId,
            viewerId,
          );
          if (!blocked) {
            await this.socialNotifications.deliver({
              recipientTelegramUserId: targetAuthorId,
              kind: 'comment_reply',
              title: 'پاسخ به تو',
              message: `${name} در پاسخ به نظرت نوشت`,
              href,
              animeId: anime.id,
            });
          }
        }
      }
    } else {
      void this.notifyFollowersOfRootComment(viewerId, anime, name).catch(
        (err) => {
          this.logger.warn(
            `follower comment notify failed: ${
              err instanceof Error ? err.message : err
            }`,
          );
        },
      );
    }

    const [dto] = await this.hydrate([saved], viewerId);
    return dto;
  }

  async remove(viewerId: string, commentId: string) {
    this.assertEnabled();
    const comment = await this.commentsRepo.findOne({
      where: { id: commentId },
    });
    if (!comment) throw new NotFoundException('Comment not found');
    if (String(comment.telegramUserId) !== viewerId) {
      throw new ForbiddenException('not your comment');
    }
    comment.isDeleted = true;
    await this.commentsRepo.save(comment);
    return { ok: true as const };
  }

  async like(viewerId: string, commentId: string) {
    this.assertEnabled();
    const comment = await this.requireActiveComment(commentId);
    const already = await this.likesRepo.findOne({
      where: { commentId: comment.id, telegramUserId: viewerId },
    });
    if (!already) {
      await this.likesRepo.save({
        commentId: comment.id,
        telegramUserId: viewerId,
      });

      const authorId = String(comment.telegramUserId);
      if (authorId !== viewerId) {
        const blocked = await this.moderation.arePeersBlocked(
          authorId,
          viewerId,
        );
        if (!blocked) {
          const likeCount = await this.likesRepo.count({
            where: { commentId: comment.id },
          });
          if (likeCount === 1) {
            const [anime, liker] = await Promise.all([
              this.animeRepo.findOne({ where: { id: comment.animeId } }),
              this.usersRepo.findOne({ where: { telegramUserId: viewerId } }),
            ]);
            const name = liker ? this.displayNameOf(liker) : 'یک کاربر';
            const href = anime
              ? `/anime/${encodeURIComponent(anime.slug || anime.id)}?tab=comments`
              : '/notifications';
            await this.socialNotifications.deliver({
              recipientTelegramUserId: authorId,
              kind: 'comment_like',
              title: 'پسند روی نظرت',
              message: `${name} نظرت را پسندید`,
              href,
              animeId: comment.animeId,
            });
          }
        }
      }
    }
    return this.likeState(comment.id, viewerId);
  }

  async unlike(viewerId: string, commentId: string) {
    this.assertEnabled();
    await this.likesRepo.delete({ commentId, telegramUserId: viewerId });
    return this.likeState(commentId, viewerId);
  }

  async report(viewerId: string, commentId: string, reason?: string) {
    this.assertEnabled();
    const comment = await this.requireActiveComment(commentId);
    if (String(comment.telegramUserId) === viewerId) {
      throw new BadRequestException('cannot report your own comment');
    }
    const already = await this.reportsRepo.findOne({
      where: { commentId: comment.id, telegramUserId: viewerId },
    });
    if (!already) {
      await this.reportsRepo.save({
        commentId: comment.id,
        telegramUserId: viewerId,
        reason: reason?.trim() || null,
      });
    }
    return { ok: true as const };
  }

  private async requireActiveComment(commentId: string): Promise<AnimeComment> {
    const comment = await this.commentsRepo.findOne({
      where: { id: commentId },
    });
    if (!comment || comment.isDeleted) {
      throw new NotFoundException('Comment not found');
    }
    return comment;
  }

  private async likeState(commentId: string, viewerId: string) {
    const like_count = await this.likesRepo.count({ where: { commentId } });
    const liked_by_me = await this.likesRepo.exists({
      where: { commentId, telegramUserId: viewerId },
    });
    return { ok: true as const, like_count, liked_by_me };
  }

  private async hydrate(
    rows: AnimeComment[],
    viewerId: string,
  ): Promise<AnimeCommentDto[]> {
    if (rows.length === 0) return [];

    const blocked = await this.moderation.blockedPeerIds(viewerId);
    const visibleRows = rows.filter(
      (row) => !blocked.has(String(row.telegramUserId)),
    );
    if (visibleRows.length === 0) return [];

    const ids = visibleRows.map((r) => r.id);
    const replyToIds = [
      ...new Set(
        visibleRows
          .map((r) => r.replyToCommentId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const replyToRows =
      replyToIds.length > 0
        ? await this.commentsRepo.find({ where: { id: In(replyToIds) } })
        : [];
    const replyToById = new Map(replyToRows.map((r) => [r.id, r]));

    const authorIds = [
      ...new Set([
        ...visibleRows.map((r) => String(r.telegramUserId)),
        ...replyToRows.map((r) => String(r.telegramUserId)),
      ]),
    ];
    const users = await this.usersRepo.find({
      where: { telegramUserId: In(authorIds) },
    });
    const userById = new Map(users.map((u) => [String(u.telegramUserId), u]));

    const authorDto = (telegramUserId: string): AnimeCommentAuthorDto => {
      const user = userById.get(telegramUserId);
      return {
        telegram_user_id: telegramUserId,
        display_name:
          user?.socialDisplayName?.trim() ||
          user?.firstName?.trim() ||
          user?.username?.trim() ||
          'کاربر',
        username: null,
        photo_url: user?.photoUrl?.trim() || null,
      };
    };

    const replyRows = await this.commentsRepo
      .createQueryBuilder('c')
      .select('c.parent_id', 'parent_id')
      .addSelect('COUNT(*)', 'count')
      .where('c.parent_id IN (:...ids)', { ids })
      .andWhere('c.is_deleted = false')
      .groupBy('c.parent_id')
      .getRawMany<{ parent_id: string; count: string }>();
    const replyById = new Map(
      replyRows.map((r) => [String(r.parent_id), Number(r.count) || 0]),
    );

    const likeRows = await this.likesRepo
      .createQueryBuilder('l')
      .select('l.comment_id', 'comment_id')
      .addSelect('COUNT(*)', 'count')
      .addSelect(`BOOL_OR(l.telegram_user_id = :viewer)`, 'liked')
      .where('l.comment_id IN (:...ids)', { ids })
      .setParameter('viewer', viewerId)
      .groupBy('l.comment_id')
      .getRawMany<{
        comment_id: string;
        count: string;
        liked: boolean | string;
      }>();
    const likeById = new Map(
      likeRows.map((r) => [
        String(r.comment_id),
        {
          count: Number(r.count) || 0,
          liked: r.liked === true || r.liked === 'true' || r.liked === 't',
        },
      ]),
    );

    return visibleRows.map((row) => {
      const likes = likeById.get(row.id);
      const replyTarget = row.replyToCommentId
        ? replyToById.get(row.replyToCommentId)
        : undefined;
      return {
        id: row.id,
        anime_id: row.animeId,
        parent_id: row.parentId,
        body: row.isDeleted ? '' : row.body,
        created_at: row.createdAt.toISOString(),
        updated_at: row.updatedAt.toISOString(),
        is_deleted: row.isDeleted,
        is_own: String(row.telegramUserId) === viewerId,
        author: authorDto(String(row.telegramUserId)),
        reply_to:
          replyTarget && !replyTarget.isDeleted
            ? {
                comment_id: replyTarget.id,
                author: authorDto(String(replyTarget.telegramUserId)),
              }
            : null,
        reply_count: replyById.get(row.id) ?? 0,
        like_count: likes?.count ?? 0,
        liked_by_me: likes?.liked ?? false,
      };
    });
  }
}
