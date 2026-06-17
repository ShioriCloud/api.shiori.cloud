import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser, UserNotification } from '../../entities';
import { UpdateNotificationPreferencesDto } from './anime-notifications.dto';

@Injectable()
export class AnimeNotificationsService {
  constructor(
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
  ) {}

  async list(telegramUserId: string, limit = 50) {
    const take = Math.min(Math.max(limit, 1), 100);
    const rows = await this.notificationsRepo.find({
      where: { telegramUserId },
      order: { createdAt: 'DESC' },
      take,
    });

    return rows.map((row) => ({
      id: row.id,
      kind: row.kind,
      title: row.title,
      message: row.message,
      href: row.href,
      anime_id: row.animeId,
      episode_number: row.episodeNumber,
      is_read: row.isRead,
      created_at: row.createdAt.toISOString(),
    }));
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

    await this.usersRepo.save(user);
    return {
      notify_new_episode: user.notifyNewEpisode,
      notify_telegram_dm: user.notifyTelegramDm,
    };
  }
}
