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
  telegram_sent?: number;
  telegram_errors?: Array<{ chat_id: number; message: string }>;
};

const pickAnimeTitle = (anime: Anime): string => {
  const title = anime.title?.trim();
  if (title) return title;
  const romaji = anime.titleRomaji?.trim();
  if (romaji) return romaji;
  return 'انیمه';
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
    private readonly config: ConfigService,
  ) {}

  async listCampaigns(
    query: ListNotificationCampaignsQueryDto,
  ): Promise<{
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
        ? campaigns[campaigns.length - 1].createdAt?.toISOString?.() ?? null
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

    const title = 'قسمت جدید منتشر شد';
    const message = `قسمت ${dto.episodeNumber} انیمه «${pickAnimeTitle(anime)}» آماده تماشاست.`;
    const href = `/anime/${dto.animeId}`;

    const prefOn = (value: unknown): boolean => {
      if (value === false || value === 0 || value === '0') return false;
      if (value === 'f' || value === 'false' || value === 'FALSE') return false;
      return true; // default true (null / true / 't')
    };

    // Reminder holders ∩ channel prefs. Skip users with both channels off.
    const reminderRows = await this.remindersRepo
      .createQueryBuilder('r')
      .innerJoin(
        TelegramUser,
        'u',
        'u.telegram_user_id = r.telegram_user_id',
      )
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
    let telegramErrors: Array<{ chat_id: number; message: string }> = [];

    if (dto.sendTelegram !== false && telegramUserIds.length > 0) {
      const miniAppBaseUrl = this.resolveMiniAppBaseUrl(dto.miniAppBaseUrl);
      const webAppUrl =
        miniAppBaseUrl.length > 0
          ? `${miniAppBaseUrl}${href}`
          : null;

      const result = await this.telegramBot.sendEpisodeNotifications({
        chatIds: telegramUserIds,
        text: message,
        webAppUrl,
      });

      telegramSent = result.sent;
      telegramErrors = result.errors.slice(0, 10);

      if (telegramSent > 0) {
        await this.campaignsRepo.update(campaign.id, {
          telegramSentCount: telegramSent,
        });

        // Mark telegram_sent_at on inbox rows for successfully notified users
        if (result.sentChatIds.length > 0) {
          await this.dataSource
            .createQueryBuilder()
            .update(UserNotification)
            .set({ telegramSentAt: () => 'now()' })
            .where('campaign_id = :campaignId', { campaignId: campaign.id })
            .andWhere('telegram_user_id IN (:...ids)', {
              ids: result.sentChatIds.map(String),
            })
            .execute();
        }
      }
    }

    return {
      ok: true,
      campaign_id: campaign.id,
      inbox_created: inboxRecipients.length,
      telegram_candidates: telegramUserIds.length,
      telegram_sent: telegramSent,
      telegram_errors: telegramErrors.length > 0 ? telegramErrors : undefined,
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

    const audience = dto.audience || 'all';
    let recipientIds: string[];

    if (audience === 'airing_reminder') {
      if (!dto.animeId) {
        throw new BadRequestException('animeId required for airing_reminder audience');
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
        .find({ where: { animeId: dto.animeId }, select: { telegramUserId: true } });
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
          href: dto.href ?? null,
          animeId: dto.animeId ?? null,
          episodeNumber: null,
          campaignId: savedCampaign.id,
          isRead: false,
        })),
      );

      return savedCampaign;
    });

    let telegramSent = 0;
    let telegramErrors: Array<{ chat_id: number; message: string }> = [];

    if (dto.sendTelegram !== false) {
      const chatIds = recipientIds
        .map(Number)
        .filter((id) => Number.isFinite(id) && id > 0);

      if (chatIds.length > 0) {
        const result = await this.telegramBot.sendEpisodeNotifications({
          chatIds,
          text: `${title}\n${message}`,
          webAppUrl: null,
        });

        telegramSent = result.sent;
        telegramErrors = result.errors.slice(0, 10);

        if (telegramSent > 0) {
          await this.campaignsRepo.update(campaign.id, {
            telegramSentCount: telegramSent,
          });

          if (result.sentChatIds.length > 0) {
            await this.dataSource
              .createQueryBuilder()
              .update(UserNotification)
              .set({ telegramSentAt: () => 'now()' })
              .where('campaign_id = :campaignId', { campaignId: campaign.id })
              .andWhere('telegram_user_id IN (:...ids)', {
                ids: result.sentChatIds.map(String),
              })
              .execute();
          }
        }
      }
    }

    return {
      ok: true,
      campaign_id: campaign.id,
      inbox_created: recipientIds.length,
      telegram_sent: telegramSent,
      telegram_errors: telegramErrors.length > 0 ? telegramErrors : undefined,
    };
  }
}
