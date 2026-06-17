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
  UserAnimeListEntry,
  UserNotification,
} from '../../entities';
import { TelegramBotService } from '../../telegram/telegram-bot.service';
import {
  ListNotificationCampaignsQueryDto,
  NotifyEpisodeReleaseDto,
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
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly telegramBot: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  async listCampaigns(
    query: ListNotificationCampaignsQueryDto,
  ): Promise<NotificationCampaignRow[]> {
    const limit = query.limit && query.limit > 0 ? query.limit : 50;

    const campaigns = await this.campaignsRepo.find({
      relations: { anime: true },
      order: { createdAt: 'DESC' },
      take: limit,
    });

    return campaigns.map((campaign) => ({
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
  }

  async notifyEpisodeRelease(
    dto: NotifyEpisodeReleaseDto,
    createdBy: string,
  ): Promise<EpisodeReleaseNotifyResult> {
    const anime = await this.animeRepo.findOne({ where: { id: dto.animeId } });
    if (!anime) throw new NotFoundException('anime not found');

    const episode = await this.episodesRepo.findOne({
      where: { animeId: dto.animeId, episodeNumber: dto.episodeNumber },
    });
    if (!episode) {
      throw new BadRequestException('episode not found for this anime');
    }

    const title = 'قسمت جدید منتشر شد';
    const message = `قسمت ${dto.episodeNumber} انیمه «${pickAnimeTitle(anime)}» آماده تماشاست.`;
    const href = `/anime/${dto.animeId}`;

    const recipients = await this.listRepo
      .createQueryBuilder('l')
      .innerJoin(TelegramUser, 'u', 'u.telegramUserId = l.telegramUserId')
      .where('l.animeId = :animeId', { animeId: dto.animeId })
      .andWhere('u.notifyNewEpisode = true')
      .select('l.telegramUserId', 'telegram_user_id')
      .addSelect('u.notifyTelegramDm', 'notify_telegram_dm')
      .getRawMany<{
        telegram_user_id: string;
        notify_telegram_dm: boolean;
      }>();

    const campaign = await this.dataSource.transaction(async (manager) => {
      const savedCampaign = await manager.save(NotificationCampaign, {
        kind: 'new_episode',
        animeId: dto.animeId,
        episodeNumber: dto.episodeNumber,
        title,
        message,
        recipientCount: recipients.length,
        telegramSentCount: 0,
        createdBy,
      });

      if (recipients.length > 0) {
        await manager.insert(
          UserNotification,
          recipients.map((row) => ({
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
      .filter((row) => row.notify_telegram_dm !== false)
      .map((row) => Number(row.telegram_user_id))
      .filter((id) => Number.isFinite(id) && id > 0);

    let telegramSent = 0;
    let telegramErrors: Array<{ chat_id: number; message: string }> = [];

    if (dto.sendTelegram !== false && telegramUserIds.length > 0) {
      const miniAppBaseUrl =
        dto.miniAppBaseUrl?.trim() ||
        this.config.get<string>('miniApp.baseUrl')?.trim() ||
        '';
      const webAppUrl =
        miniAppBaseUrl.length > 0
          ? `${miniAppBaseUrl.replace(/\/$/, '')}${href}`
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
      }
    }

    return {
      ok: true,
      campaign_id: campaign.id,
      inbox_created: recipients.length,
      telegram_candidates: telegramUserIds.length,
      telegram_sent: telegramSent,
      telegram_errors: telegramErrors.length > 0 ? telegramErrors : undefined,
    };
  }
}
