import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  AnimeComment,
  DownloadTokenLedger,
  TelegramUser,
  UserAnimeListEntry,
  UserEpisodeDownloadReceipt,
} from '../../entities';
import type { BadgeUserMetrics } from './social-badge-catalog';

@Injectable()
export class SocialBadgeMetricsService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(UserEpisodeDownloadReceipt)
    private readonly receiptRepo: Repository<UserEpisodeDownloadReceipt>,
    @InjectRepository(DownloadTokenLedger)
    private readonly ledgerRepo: Repository<DownloadTokenLedger>,
  ) {}

  async collectForUser(telegramUserId: string): Promise<BadgeUserMetrics> {
    const userId = String(telegramUserId);

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: userId },
    });

    const listRows = await this.listRepo.find({
      where: { telegramUserId: userId },
    });

    const uniqueSavedAnime = new Set(listRows.map((r) => r.animeId)).size;

    const uniqueRatedAnime = new Set(
      listRows
        .filter(
          (r) =>
            r.userRating != null &&
            r.userRating !== '' &&
            Number.isFinite(Number(r.userRating)),
        )
        .map((r) => r.animeId),
    ).size;

    const uniqueCompletedAnime = listRows.filter(
      (r) => String(r.listStatus ?? '').trim() === 'completed',
    ).length;

    const approvedCommentRows = await this.commentsRepo
      .createQueryBuilder('c')
      .select(['c.animeId'])
      .where('c.telegram_user_id = :userId', { userId })
      .andWhere('c.is_deleted = false')
      .andWhere(`c.moderation_status = 'approved'`)
      .getMany();

    const approvedComments = approvedCommentRows.length;
    const uniqueCommentedAnime = new Set(
      approvedCommentRows.map((r) => r.animeId),
    ).size;

    const receiptRows = await this.receiptRepo.find({
      where: { telegramUserId: userId },
      select: { episodeId: true },
    });
    const episodeIds = new Set(receiptRows.map((r) => r.episodeId));

    const ledgerRows = await this.ledgerRepo
      .createQueryBuilder('l')
      .select('DISTINCT l.ref_id', 'ref_id')
      .where('l.telegram_user_id = :userId', { userId })
      .andWhere(`l.reason = 'free_download'`)
      .andWhere(`l.ref_type = 'episode'`)
      .andWhere('l.ref_id IS NOT NULL')
      .getRawMany<{ ref_id: string }>();

    for (const row of ledgerRows) {
      const id = String(row.ref_id ?? '').trim();
      if (id) episodeIds.add(id);
    }

    const uniqueReceivedEpisodes = episodeIds.size;

    const firstSeen = user?.firstSeenAt ?? null;
    const lastSeen = user?.lastSeenAt ?? null;
    let accountAgeDays = 0;
    if (firstSeen) {
      const ms = Date.now() - firstSeen.getTime();
      accountAgeDays = Math.max(0, Math.floor(ms / (24 * 60 * 60 * 1000)));
    }

    const loyaltyActivityOk =
      user && lastSeen && firstSeen
        ? lastSeen.getTime() >= firstSeen.getTime() + 90 * 24 * 60 * 60 * 1000
          ? 1
          : 0
        : 0;

    return {
      user_registered: user ? 1 : 0,
      unique_saved_anime: uniqueSavedAnime,
      unique_received_episodes: uniqueReceivedEpisodes,
      unique_completed_anime: uniqueCompletedAnime,
      approved_comments: approvedComments,
      unique_commented_anime: uniqueCommentedAnime,
      unique_rated_anime: uniqueRatedAnime,
      account_age_days: accountAgeDays,
      loyalty_activity_ok: loyaltyActivityOk,
    };
  }
}
