import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser, UserNotification } from '../../entities';
import { TelegramDmOutboxService } from '../telegram-dm/telegram-dm-outbox.service';
import { TelegramBotService } from '../../telegram/telegram-bot.service';

export type SocialInboxKind =
  | 'social_follow'
  | 'comment_reply'
  | 'comment_like'
  | 'following_comment';

type DeliverInput = {
  recipientTelegramUserId: string;
  kind: SocialInboxKind;
  title: string;
  message: string;
  href: string;
  animeId?: string | null;
};

@Injectable()
export class SocialNotificationDeliveryService {
  private readonly logger = new Logger(SocialNotificationDeliveryService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly telegramBot: TelegramBotService,
    private readonly telegramDmOutbox: TelegramDmOutboxService,
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
  ) {}

  private inboxAllowed(user: TelegramUser, kind: SocialInboxKind): boolean {
    switch (kind) {
      case 'social_follow':
        return user.notifySocialFollow !== false;
      case 'comment_reply':
        return user.notifyCommentReply !== false;
      case 'comment_like':
        return user.notifyCommentLike !== false;
      case 'following_comment':
        return user.notifyFollowingComment !== false;
      default:
        return true;
    }
  }

  private resolveWebAppUrl(href: string): string | null {
    const base = (this.config.get<string>('miniApp.baseUrl') ?? '')
      .trim()
      .replace(/\/$/, '');
    if (!base) return null;
    const path = href.startsWith('/') ? href : `/${href}`;
    return `${base}${path}`;
  }

  async deliver(input: DeliverInput): Promise<void> {
    const recipientId = String(input.recipientTelegramUserId).trim();
    if (!recipientId) return;

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: recipientId },
    });
    if (!user || !this.inboxAllowed(user, input.kind)) return;

    const saved = await this.notificationsRepo.save(
      this.notificationsRepo.create({
        telegramUserId: recipientId,
        kind: input.kind,
        title: input.title,
        message: input.message,
        href: input.href,
        animeId: input.animeId ?? null,
        episodeNumber: null,
        campaignId: null,
        isRead: false,
      }),
    );

    if (user.notifyTelegramDm === false) return;

    const chatId = Number(recipientId);
    if (!Number.isFinite(chatId) || chatId <= 0) return;

    const text = `${input.title}\n${input.message}`;
    const webAppUrl = this.resolveWebAppUrl(input.href);

    const result = await this.telegramBot.sendEpisodeNotifications({
      chatIds: [chatId],
      text,
      webAppUrl,
    });

    if (result.sent > 0) {
      saved.telegramSentAt = new Date();
      await this.notificationsRepo.save(saved);
      return;
    }

    const err = result.errors[0]?.message ?? 'send failed';
    const shouldQueue =
      result.errors.length > 0 &&
      /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network|429/i.test(err);

    if (shouldQueue || result.sent === 0) {
      try {
        await this.telegramDmOutbox.enqueueMany([
          {
            campaignId: null,
            chatId,
            text,
            webAppUrl,
          },
        ]);
      } catch (e) {
        this.logger.warn(
          `Social DM outbox enqueue failed for ${recipientId}: ${
            e instanceof Error ? e.message : e
          }`,
        );
      }
    }
  }
}
