import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  NotificationCampaign,
  TelegramDmOutbox,
  UserNotification,
} from '../../entities';

export type EnqueueTelegramDmInput = {
  campaignId?: string | null;
  chatId: number | string;
  text: string;
  webAppUrl?: string | null;
};

export type TelegramDmAckResult = {
  id: string;
  ok: boolean;
  error?: string | null;
};

@Injectable()
export class TelegramDmOutboxService {
  private readonly logger = new Logger(TelegramDmOutboxService.name);

  constructor(
    @InjectRepository(TelegramDmOutbox)
    private readonly outboxRepo: Repository<TelegramDmOutbox>,
    @InjectRepository(NotificationCampaign)
    private readonly campaignsRepo: Repository<NotificationCampaign>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
  ) {}

  async enqueueMany(items: EnqueueTelegramDmInput[]): Promise<number> {
    const rows = items
      .map((item) => {
        const chatId = String(item.chatId ?? '').trim();
        const text = String(item.text ?? '').trim();
        if (!chatId || !text) return null;
        return this.outboxRepo.create({
          campaignId: item.campaignId ? String(item.campaignId) : null,
          chatId,
          text,
          webAppUrl: item.webAppUrl?.trim() || null,
          status: 'pending',
          error: null,
          attempts: 0,
          claimedAt: null,
          sentAt: null,
        });
      })
      .filter((row): row is TelegramDmOutbox => Boolean(row));

    if (!rows.length) return 0;
    await this.outboxRepo.save(rows);
    this.logger.log(`queued ${rows.length} telegram DM(s) for tel-bot`);
    return rows.length;
  }

  /**
   * Claim pending (or stale claimed) rows for tel-bot delivery.
   */
  async claimPending(limitRaw?: number): Promise<{
    items: Array<{
      id: string;
      campaign_id: string | null;
      chat_id: number;
      text: string;
      web_app_url: string | null;
      attempts: number;
    }>;
  }> {
    const limit = Math.min(100, Math.max(1, Number(limitRaw) || 40));

    const claimed: Array<Record<string, unknown>> = await this.dataSource.query(
      `
      UPDATE telegram_dm_outbox AS o
      SET
        status = 'claimed',
        claimed_at = now(),
        attempts = o.attempts + 1
      WHERE o.id IN (
        SELECT id
        FROM telegram_dm_outbox
        WHERE status = 'pending'
           OR (
             status = 'claimed'
             AND claimed_at IS NOT NULL
             AND claimed_at < now() - interval '2 minutes'
           )
        ORDER BY created_at ASC
        LIMIT $1
        FOR UPDATE SKIP LOCKED
      )
      RETURNING
        o.id,
        o.campaign_id,
        o.chat_id,
        o.text,
        o.web_app_url,
        o.attempts
      `,
      [limit],
    );

    return {
      items: claimed.map((row) => ({
        id: String(row.id),
        campaign_id: row.campaign_id != null ? String(row.campaign_id) : null,
        chat_id: Number(row.chat_id),
        text: String(row.text ?? ''),
        web_app_url: row.web_app_url != null ? String(row.web_app_url) : null,
        attempts: Number(row.attempts) || 0,
      })),
    };
  }

  async ackResults(results: TelegramDmAckResult[]): Promise<{
    ok: true;
    sent: number;
    failed: number;
  }> {
    if (!Array.isArray(results) || results.length === 0) {
      throw new BadRequestException('results required');
    }

    let sent = 0;
    let failed = 0;
    const sentByCampaign = new Map<string, string[]>();

    for (const result of results) {
      const id = String(result?.id ?? '').trim();
      if (!id) continue;

      const row = await this.outboxRepo.findOne({ where: { id } });
      if (!row) continue;

      if (result.ok) {
        row.status = 'sent';
        row.sentAt = new Date();
        row.error = null;
        await this.outboxRepo.save(row);
        sent += 1;
        if (row.campaignId) {
          const list = sentByCampaign.get(row.campaignId) ?? [];
          list.push(row.chatId);
          sentByCampaign.set(row.campaignId, list);
        }
      } else {
        row.status = 'failed';
        row.error = String(result.error ?? 'send failed').slice(0, 500);
        await this.outboxRepo.save(row);
        failed += 1;
      }
    }

    for (const [campaignId, chatIds] of sentByCampaign) {
      const unique = [...new Set(chatIds)];
      if (!unique.length) continue;

      await this.campaignsRepo.increment(
        { id: campaignId },
        'telegramSentCount',
        unique.length,
      );

      await this.dataSource
        .createQueryBuilder()
        .update(UserNotification)
        .set({ telegramSentAt: () => 'now()' })
        .where('campaign_id = :campaignId', { campaignId })
        .andWhere('telegram_user_id IN (:...ids)', { ids: unique })
        .andWhere('telegram_sent_at IS NULL')
        .execute();
    }

    return { ok: true, sent, failed };
  }

  /** Drop undelivered rows older than N days (optional housekeeping). */
  async purgeOld(days = 14): Promise<number> {
    const result = await this.outboxRepo
      .createQueryBuilder()
      .delete()
      .where('created_at < now() - make_interval(days => :days)', {
        days: Math.max(1, days),
      })
      .andWhere('status IN (:...statuses)', {
        statuses: ['sent', 'failed'],
      })
      .execute();
    return result.affected ?? 0;
  }
}
