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
  TelegramUser,
  UserAnimeAiringReminder,
  UserNotification,
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

    return {
      items: rows.map((row) => ({
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
      })),
      has_more: hasMore,
      next_before: hasMore ? rows[rows.length - 1].createdAt.toISOString() : null,
    };
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
