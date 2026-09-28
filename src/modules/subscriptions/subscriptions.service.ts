import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AdminAuditEvent,
  Anime,
  AnimeEpisode,
  TelegramUser,
} from '../../entities';
import {
  extendSubscriptionExpiry,
  hasActiveSubscription,
  SUBSCRIPTION_DAYS,
  SUBSCRIPTION_MONTHLY_AMOUNT_IRR,
} from './subscription.util';

@Injectable()
export class SubscriptionsService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(AnimeEpisode)
    private readonly episodesRepo: Repository<AnimeEpisode>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AdminAuditEvent)
    private readonly auditRepo: Repository<AdminAuditEvent>,
  ) {}

  private async recordAdminGrantAudit(input: {
    actorTelegramUserId?: string | null;
    targetTelegramUserId: string;
    days: number;
    note?: string | null;
  }): Promise<void> {
    const actor = String(input.actorTelegramUserId ?? '').trim();
    if (!actor || input.days < 1) return;
    try {
      await this.auditRepo.save(
        this.auditRepo.create({
          actorTelegramUserId: actor,
          action: 'grant_subscription',
          targetTelegramUserId: String(input.targetTelegramUserId),
          meta: {
            days: input.days,
            ...(input.note?.trim() ? { note: input.note.trim() } : {}),
          },
        }),
      );
    } catch (err) {
      console.warn(
        'admin audit write failed:',
        err instanceof Error ? err.message : String(err),
      );
    }
  }

  private monthlyAmountIrr(): number {
    const fromConfig = this.config.get<number>('subscription.monthlyAmountIrr');
    return typeof fromConfig === 'number' && fromConfig > 0
      ? fromConfig
      : SUBSCRIPTION_MONTHLY_AMOUNT_IRR;
  }

  private subscriptionDays(): number {
    const fromConfig = this.config.get<number>('subscription.days');
    return typeof fromConfig === 'number' && fromConfig > 0
      ? fromConfig
      : SUBSCRIPTION_DAYS;
  }

  private async ensureUser(telegramUserId: string): Promise<TelegramUser> {
    let user = await this.usersRepo.findOne({ where: { telegramUserId } });
    if (user) return user;
    user = this.usersRepo.create({
      telegramUserId,
      firstName: 'کاربر',
      downloadTokenBalance: 10,
      subscriptionExpiresAt: null,
    });
    return this.usersRepo.save(user);
  }

  async getMe(telegramUserId: string): Promise<{
    active: boolean;
    expires_at: string | null;
    status: 'none' | 'active' | 'expired';
  }> {
    const user = await this.ensureUser(telegramUserId);
    const expiresAt = user.subscriptionExpiresAt ?? null;
    const active = hasActiveSubscription(expiresAt);
    let status: 'none' | 'active' | 'expired' = 'none';
    if (expiresAt) status = active ? 'active' : 'expired';
    return {
      active,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      status,
    };
  }

  async isActive(telegramUserId: string): Promise<boolean> {
    const me = await this.getMe(telegramUserId);
    return me.active;
  }

  async grantDays(input: {
    telegramUserId: string;
    days?: number;
    note?: string | null;
    actorTelegramUserId?: string | null;
  }): Promise<{ active: boolean; expires_at: string; days: number }> {
    const telegramUserId = String(input.telegramUserId).trim();
    if (!telegramUserId) {
      throw new BadRequestException('telegram_user_id required');
    }
    const days =
      typeof input.days === 'number' && input.days > 0
        ? Math.floor(input.days)
        : this.subscriptionDays();

    const user = await this.ensureUser(telegramUserId);
    user.subscriptionExpiresAt = extendSubscriptionExpiry(
      user.subscriptionExpiresAt,
      days,
    );
    await this.usersRepo.save(user);

    await this.recordAdminGrantAudit({
      actorTelegramUserId: input.actorTelegramUserId,
      targetTelegramUserId: telegramUserId,
      days,
      note: input.note,
    });

    return {
      active: true,
      expires_at: user.subscriptionExpiresAt.toISOString(),
      days,
    };
  }

  /**
   * Credit one month when paid amount meets the monthly subscription tier.
   * Larger amounts still grant one month for now (single plan).
   */
  async grantFromDonationAmount(input: {
    telegramUserId: string;
    amountIrr: number;
    note?: string | null;
    paymentId?: string | null;
  }): Promise<{ active: boolean; expires_at: string; credited_days: number }> {
    const amount = Number(input.amountIrr);
    const minAmount = this.monthlyAmountIrr();
    if (!Number.isFinite(amount) || amount < minAmount) {
      throw new BadRequestException(
        `amount_irr must be at least ${minAmount}`,
      );
    }

    const noteParts = [
      input.note?.trim() || null,
      input.paymentId ? `payment:${input.paymentId}` : null,
      `amount_irr:${Math.floor(amount)}`,
    ].filter(Boolean);

    const result = await this.grantDays({
      telegramUserId: input.telegramUserId,
      days: this.subscriptionDays(),
      note: noteParts.join(' | ') || null,
    });

    return {
      active: result.active,
      expires_at: result.expires_at,
      credited_days: result.days,
    };
  }

  async claimPaidEpisodeDownload(
    telegramUserId: string,
    episodeId: string,
  ): Promise<{ download_link: string; expires_at: string | null }> {
    const me = await this.getMe(telegramUserId);
    if (!me.active) {
      throw new ForbiddenException({
        code: 'subscription_required',
        message: 'active subscription required for softsub/hardsub downloads',
      });
    }

    const episode = await this.episodesRepo.findOne({ where: { id: episodeId } });
    if (!episode) throw new NotFoundException('episode not found');

    const type = String(episode.videoFileType ?? 'softsub').trim().toLowerCase();
    if (type === 'free') {
      throw new BadRequestException('use free-download claim for free episodes');
    }
    if (type !== 'softsub' && type !== 'hardsub') {
      throw new BadRequestException('episode type is not downloadable via subscription');
    }

    const downloadLink =
      episode.downloadLink?.trim() ||
      `https://t.me/ShioriUploadBot?start=get_${episode.id}`;

    return { download_link: downloadLink, expires_at: me.expires_at };
  }

  async claimEpisodePack(
    telegramUserId: string,
    animeId: string,
  ): Promise<{ download_link: string; title: string | null; expires_at: string | null }> {
    const me = await this.getMe(telegramUserId);
    if (!me.active) {
      throw new ForbiddenException({
        code: 'subscription_required',
        message: 'active subscription required for episode pack download',
      });
    }

    const anime = await this.animeRepo.findOne({ where: { id: animeId } });
    if (!anime) throw new NotFoundException('anime not found');
    const downloadLink = anime.episodePackLink?.trim();
    if (!downloadLink) {
      throw new NotFoundException('episode pack not available');
    }

    return {
      download_link: downloadLink,
      title: anime.episodePackTitle,
      expires_at: me.expires_at,
    };
  }
}
