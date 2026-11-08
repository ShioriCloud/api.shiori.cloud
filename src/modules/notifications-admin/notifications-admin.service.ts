import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  Anime,
  AnimeEpisode,
  NotificationCampaign,
  TelegramUser,
  UserAnimeAiringReminder,
  UserAnimeListEntry,
  UserNotification,
} from '../../entities';
import { TelegramDmOutboxService } from '../telegram-dm/telegram-dm-outbox.service';
import { TelegramBotService } from '../../telegram/telegram-bot.service';
import {
  ListNotificationCampaignsQueryDto,
  NotifyEpisodeReleaseDto,
  SendBroadcastDto,
} from './notifications-admin.dto';

export type NotificationCampaignRow = {
  id: string;
  kind: string;
  anime_id: string | null;
  anime_title: string | null;
  episode_number: number | null;
  title: string;
  message: string;
  recipient_count: number;
  telegram_sent_count: number;
  created_at: string;
};

export type EpisodeReleaseNotifyResult = {
  ok: boolean;
  already_sent?: boolean;
  campaign_id?: string;
  inbox_created?: number;
  telegram_candidates?: number;
  telegram_queued?: number;
  telegram_sent?: number;
  telegram_delivery?: 'direct' | 'queued_for_bot' | 'mixed' | 'skipped';
  telegram_errors?: Array<{ chat_id: number; message: string }>;
};

const pickAnimeTitle = (anime: Anime): string => {
  const title = anime.title?.trim();
  if (title) return title;
  const romaji = anime.titleRomaji?.trim();
  if (romaji) return romaji;
  return 'انیمه';
};

const escapeHtml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** Same channel-address marker as TheShioriSub captions (override via CUSTOM_EMOJI_CHAT). */
const channelAddressEmoji = (): string => {
  const id = process.env.CUSTOM_EMOJI_CHAT?.trim() || '5215334566549540768';
  return `<tg-emoji emoji-id="${id}">💬</tg-emoji>`;
};

const buildEpisodeReleaseInboxMessage = (
  episodeNumber: number,
  animeTitle: string,
): string => `قسمت ${episodeNumber} انیمه ${animeTitle} آماده‌ی دانلوده.`;

const buildEpisodeReleaseTelegramMessage = (
  episodeNumber: number,
  animeTitle: string,
): string => {
  const marker = channelAddressEmoji();
  return [
    `قسمت ${episodeNumber} انیمه <b>${escapeHtml(animeTitle)}</b> آماده‌ی دانلوده.`,
    '',
    `${marker} @TheShiori`,
    `${marker} @TheShioriSub`,
  ].join('\n');
};

@Injectable()
export class NotificationsAdminService {
  constructor(
    @InjectRepository(NotificationCampaign)
    private readonly campaignsRepo: Repository<NotificationCampaign>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeEpisode)
    private readonly episodesRepo: Repository<AnimeEpisode>,
    @InjectRepository(UserAnimeAiringReminder)
    private readonly remindersRepo: Repository<UserAnimeAiringReminder>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly telegramBot: TelegramBotService,
    private readonly telegramDmOutbox: TelegramDmOutboxService,
    private readonly config: ConfigService,
  ) {}

  async listCampaigns(query: ListNotificationCampaignsQueryDto): Promise<{
    items: NotificationCampaignRow[];
    has_more: boolean;
    next_before: string | null;
  }> {
    const limit = query.limit && query.limit > 0 ? query.limit : 50;

    const qb = this.campaignsRepo
      .createQueryBuilder('c')
      .leftJoinAndSelect('c.anime', 'anime')
      .orderBy('c.createdAt', 'DESC')
      .take(limit + 1);

    if (query.before) {
      qb.where('c.createdAt < :before', { before: query.before });
    }

    const campaigns = await qb.getMany();
    const hasMore = campaigns.length > limit;
    if (hasMore) campaigns.pop();

    const items = campaigns.map((campaign) => ({
      id: campaign.id,
      kind: campaign.kind ?? 'new_episode',
      anime_id: campaign.animeId,
      anime_title: campaign.anime?.title ?? null,
      episode_number: campaign.episodeNumber,
      title: campaign.title,
      message: campaign.message,
      recipient_count: campaign.recipientCount ?? 0,
      telegram_sent_count: campaign.telegramSentCount ?? 0,
      created_at: campaign.createdAt?.toISOString?.() ?? '',
    }));

    return {
      items,
      has_more: hasMore,
      next_before: hasMore
        ? (campaigns[campaigns.length - 1].createdAt?.toISOString?.() ?? null)
        : null,
    };
  }

  async notifyEpisodeRelease(
    dto: NotifyEpisodeReleaseDto,
    createdBy: string | number | null,
  ): Promise<EpisodeReleaseNotifyResult> {
    const anime = await this.animeRepo.findOne({ where: { id: dto.animeId } });
    if (!anime) throw new NotFoundException('anime not found');

    const episode = await this.episodesRepo.findOne({
      where: { animeId: dto.animeId, episodeNumber: dto.episodeNumber },
    });
    if (!episode) {
      throw new BadRequestException('episode not found for this anime');
    }

    if (!dto.forceResend) {
      const existingRows = await this.campaignsRepo.find({
        where: {
          kind: 'new_episode',
          animeId: dto.animeId,
          episodeNumber: dto.episodeNumber,
        },
        order: { createdAt: 'DESC' },
        take: 1,
      });
      const existing = existingRows[0];
      if (existing) {
        return {
          ok: true,
          already_sent: true,
          campaign_id: existing.id,
          inbox_created: existing.recipientCount ?? 0,
          telegram_candidates: 0,
          telegram_sent: existing.telegramSentCount ?? 0,
        };
      }
    }

    const animeTitle = pickAnimeTitle(anime);
    const title = 'قسمت جدید منتشر شد';
    const message = buildEpisodeReleaseInboxMessage(
      dto.episodeNumber,
      animeTitle,
    );
    const telegramMessage = buildEpisodeReleaseTelegramMessage(
      dto.episodeNumber,
      animeTitle,
    );
    const href = `/anime/${dto.animeId}`;

    const prefOn = (value: unknown): boolean => {
      if (value === false || value === 0 || value === '0') return false;
      if (value === 'f' || value === 'false' || value === 'FALSE') return false;
      return true; // default true (null / true / 't')
    };

    // Reminder holders ∩ channel prefs. Skip users with both channels off.
    const reminderRows = await this.remindersRepo
      .createQueryBuilder('r')
      .innerJoin(TelegramUser, 'u', 'u.telegram_user_id = r.telegram_user_id')
      .where('r.anime_id = :animeId', { animeId: dto.animeId })
      .select('r.telegram_user_id', 'telegram_user_id')
      .addSelect('u.notify_new_episode', 'notify_new_episode')
      .addSelect('u.notify_telegram_dm', 'notify_telegram_dm')
      .getRawMany<{
        telegram_user_id: string;
        notify_new_episode: unknown;
        notify_telegram_dm: unknown;
      }>();

    const recipients = reminderRows.filter(
      (row) => prefOn(row.notify_new_episode) || prefOn(row.notify_telegram_dm),
    );
    const inboxRecipients = recipients.filter((row) =>
      prefOn(row.notify_new_episode),
    );

    const createdById =
      createdBy == null || createdBy === ''
        ? null
        : String(createdBy).match(/^\d+$/)
          ? String(createdBy)
          : null;

    const campaign = await this.dataSource.transaction(async (manager) => {
      const savedCampaign = await manager.save(NotificationCampaign, {
        kind: 'new_episode',
        animeId: dto.animeId,
        episodeNumber: dto.episodeNumber,
        title,
        message,
        recipientCount: inboxRecipients.length,
        telegramSentCount: 0,
        createdBy: createdById,
      });

      if (inboxRecipients.length > 0) {
        await manager.insert(
          UserNotification,
          inboxRecipients.map((row) => ({
            telegramUserId: row.telegram_user_id,
            kind: 'new_episode',
            title,
            message,
            href,
            animeId: dto.animeId,
            episodeNumber: dto.episodeNumber,
            campaignId: savedCampaign.id,
            isRead: false,
          })),
        );
      }

      return savedCampaign;
    });

    const telegramUserIds = recipients
      .filter((row) => prefOn(row.notify_telegram_dm))
      .map((row) => Number(row.telegram_user_id))
      .filter((id) => Number.isFinite(id) && id > 0);

    let telegramSent = 0;
    let telegramQueued = 0;
    let telegramErrors: Array<{ chat_id: number; message: string }> = [];
    let telegramDelivery: EpisodeReleaseNotifyResult['telegram_delivery'] =
      'skipped';

    if (dto.sendTelegram !== false && telegramUserIds.length > 0) {
      const miniAppBaseUrl = this.resolveMiniAppBaseUrl(dto.miniAppBaseUrl);
      const webAppUrl =
        miniAppBaseUrl.length > 0 ? `${miniAppBaseUrl}${href}` : null;

      const delivered = await this.deliverTelegramDms({
        campaignId: campaign.id,
        chatIds: telegramUserIds,
        text: telegramMessage,
        webAppUrl,
        parseMode: 'HTML',
      });
      telegramSent = delivered.sent;
      telegramQueued = delivered.queued;
      telegramErrors = delivered.errors;
      telegramDelivery = delivered.delivery;
    }

    return {
      ok: true,
      campaign_id: campaign.id,
      inbox_created: inboxRecipients.length,
      telegram_candidates: telegramUserIds.length,
      telegram_queued: telegramQueued,
      telegram_sent: telegramSent,
      telegram_delivery: telegramDelivery,
      telegram_errors: telegramErrors.length > 0 ? telegramErrors : undefined,
    };
  }

  /**
   * Prefer direct send via mini-app bot token (Europe API can reach Telegram).
   * Queue remaining failures to tel-bot outbox as fallback.
   */
  private async deliverTelegramDms(opts: {
    campaignId: string;
    chatIds: number[];
    text: string;
    webAppUrl?: string | null;
    parseMode?: 'HTML' | 'Markdown';
  }): Promise<{
    sent: number;
    queued: number;
    errors: Array<{ chat_id: number; message: string }>;
    delivery: NonNullable<EpisodeReleaseNotifyResult['telegram_delivery']>;
  }> {
    const result = await this.telegramBot.sendEpisodeNotifications({
      chatIds: opts.chatIds,
      text: opts.text,
      webAppUrl: opts.webAppUrl,
      parseMode: opts.parseMode,
    });

    const sent = result.sent;
    const errors = [...result.errors];

    if (sent > 0) {
      await this.campaignsRepo.update(opts.campaignId, {
        telegramSentCount: sent,
      });
      if (result.sentChatIds.length > 0) {
        await this.dataSource
          .createQueryBuilder()
          .update(UserNotification)
          .set({ telegramSentAt: () => 'now()' })
          .where('campaign_id = :campaignId', { campaignId: opts.campaignId })
          .andWhere('telegram_user_id IN (:...ids)', {
            ids: result.sentChatIds.map(String),
          })
          .execute();
      }
    }

    const failedChatIds = errors
      .map((row) => row.chat_id)
      .filter((id) => Number.isFinite(id) && id > 0);

    let queued = 0;
    if (failedChatIds.length > 0) {
      const looksLikeNetwork = errors.some((row) =>
        /fetch failed|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|network/i.test(
          row.message,
        ),
      );
      // Queue all remaining failures when network is broken; otherwise only
      // queue when nothing was sent directly (full outage / missing token).
      const shouldQueue = looksLikeNetwork || sent === 0;

      if (shouldQueue) {
        queued = await this.telegramDmOutbox.enqueueMany(
          failedChatIds.map((chatId) => ({
            campaignId: opts.campaignId,
            chatId,
            text: opts.text,
            webAppUrl: opts.webAppUrl,
          })),
        );
      }
    }

    const delivery =
      sent > 0 && queued > 0
        ? ('mixed' as const)
        : sent > 0
          ? ('direct' as const)
          : queued > 0
            ? ('queued_for_bot' as const)
            : ('skipped' as const);

    return {
      sent,
      queued,
      errors: queued > 0 ? [] : errors.slice(0, 10),
      delivery,
    };
  }

  private resolveMiniAppBaseUrl(dtoUrl?: string | null): string {
    const sanitize = (raw: string): string => {
      const trimmed = raw.trim();
      if (!trimmed) return '';
      try {
        const host = new URL(trimmed).hostname.toLowerCase();
        if (host.includes('dash.')) return '';
        return trimmed.replace(/\/$/, '');
      } catch {
        return '';
      }
    };
    return (
      sanitize(this.config.get<string>('miniApp.baseUrl') ?? '') ||
      sanitize(dtoUrl ?? '')
    );
  }

  async sendBroadcast(
    dto: SendBroadcastDto,
    createdBy: string | number | null,
  ) {
    const title = dto.title.trim();
    const message = dto.message.trim();
    if (!title || !message) {
      throw new BadRequestException('title and message are required');
    }

    const hrefFromDto = dto.href?.trim();
    const defaultHref = dto.animeId
      ? `/anime/${encodeURIComponent(dto.animeId)}`
      : null;
    const resolvedHref = hrefFromDto || defaultHref;

    const audience = dto.audience || 'all';
    let recipientIds: string[];

    if (audience === 'airing_reminder') {
      if (!dto.animeId) {
        throw new BadRequestException(
          'animeId required for airing_reminder audience',
        );
      }
      const rows = await this.remindersRepo.find({
        where: { animeId: dto.animeId },
        select: { telegramUserId: true },
      });
      recipientIds = rows.map((r) => r.telegramUserId);
    } else if (audience === 'in_list') {
      if (!dto.animeId) {
        throw new BadRequestException('animeId required for in_list audience');
      }
      const rows = await this.dataSource
        .getRepository(UserAnimeListEntry)
        .find({
          where: { animeId: dto.animeId },
          select: { telegramUserId: true },
        });
      recipientIds = [...new Set(rows.map((r) => r.telegramUserId))];
    } else {
      // all users
      const rows = await this.dataSource
        .getRepository(TelegramUser)
        .find({ select: { telegramUserId: true } });
      recipientIds = rows.map((r) => r.telegramUserId);
    }

    if (recipientIds.length === 0) {
      return { ok: true, inbox_created: 0, telegram_sent: 0 };
    }

    const createdById =
      createdBy == null || createdBy === ''
        ? null
        : String(createdBy).match(/^\d+$/)
          ? String(createdBy)
          : null;

    const campaign = await this.dataSource.transaction(async (manager) => {
      const savedCampaign = await manager.save(NotificationCampaign, {
        kind: 'broadcast',
        animeId: dto.animeId ?? null,
        episodeNumber: null,
        title,
        message,
        recipientCount: recipientIds.length,
        telegramSentCount: 0,
        createdBy: createdById,
      });

      await manager.insert(
        UserNotification,
        recipientIds.map((id) => ({
          telegramUserId: id,
          kind: 'broadcast',
          title,
          message,
          href: resolvedHref,
          animeId: dto.animeId ?? null,
          episodeNumber: null,
          campaignId: savedCampaign.id,
          isRead: false,
        })),
      );

      return savedCampaign;
    });

    let telegramSent = 0;
    let telegramQueued = 0;
    let telegramErrors: Array<{ chat_id: number; message: string }> | undefined;

    if (dto.sendTelegram !== false) {
      const chatIds = recipientIds
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);

      if (chatIds.length > 0) {
        const delivered = await this.deliverTelegramDms({
          campaignId: campaign.id,
          chatIds,
          text: `${title}\n${message}`,
          webAppUrl: null,
        });
        telegramSent = delivered.sent;
        telegramQueued = delivered.queued;
        telegramErrors = delivered.errors.length ? delivered.errors : undefined;

        return {
          ok: true,
          campaign_id: campaign.id,
          inbox_created: recipientIds.length,
          telegram_queued: telegramQueued,
          telegram_sent: telegramSent,
          telegram_delivery: delivered.delivery,
          telegram_errors: telegramErrors,
        };
      }
    }

    return {
      ok: true,
      campaign_id: campaign.id,
      inbox_created: recipientIds.length,
      telegram_queued: 0,
      telegram_sent: 0,
      telegram_delivery: 'skipped' as const,
    };
  }
}
