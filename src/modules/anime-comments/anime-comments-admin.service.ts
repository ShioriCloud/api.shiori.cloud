import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeComment,
  type AnimeCommentModerationStatus,
  AnimeCommentReport,
  TelegramUser,
} from '../../entities';
import { ListAnimeCommentsAdminQueryDto } from './anime-comments-admin.dto';
import { AnimeCommentsService } from './anime-comments.service';

export type AnimeCommentReportAdminItem = {
  comment_id: string;
  body: string;
  created_at: string;
  report_count: number;
  last_report_at: string;
  anime: { id: string; slug: string | null; title: string };
  author: {
    telegram_user_id: string;
    display_name: string;
    photo_url: string | null;
  };
  sample_reports: Array<{
    id: string;
    reason: string | null;
    reporter_telegram_user_id: string;
    created_at: string;
  }>;
};

@Injectable()
export class AnimeCommentsAdminService {
  constructor(
    @InjectRepository(AnimeComment)
    private readonly commentsRepo: Repository<AnimeComment>,
    @InjectRepository(AnimeCommentReport)
    private readonly reportsRepo: Repository<AnimeCommentReport>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    private readonly commentsService: AnimeCommentsService,
  ) {}

  async getPendingReportedCommentCount(): Promise<{ pending: number }> {
    const rows = await this.reportsRepo.manager.query<{ pending: number }[]>(
      `
      SELECT COUNT(DISTINCT r.comment_id)::int AS pending
      FROM anime_comment_reports r
      INNER JOIN anime_comments c ON c.id = r.comment_id AND c.is_deleted = false
      `,
    );
    return { pending: rows[0]?.pending ?? 0 };
  }

  async listReportedComments(page = 1, limit = 20) {
    const safePage = Math.max(1, page);
    const safeLimit = Math.min(100, Math.max(1, limit));
    const offset = (safePage - 1) * safeLimit;

    const countRows = await this.reportsRepo.manager.query<{ total: number }[]>(
      `
      SELECT COUNT(DISTINCT r.comment_id)::int AS total
      FROM anime_comment_reports r
      INNER JOIN anime_comments c ON c.id = r.comment_id AND c.is_deleted = false
      `,
    );
    const total = countRows[0]?.total ?? 0;
    const totalPages = Math.max(1, Math.ceil(total / safeLimit));

    const ranked = await this.reportsRepo.manager.query<
      Array<{
        comment_id: string;
        report_count: number;
        last_report_at: Date;
      }>
    >(
      `
      SELECT r.comment_id AS comment_id,
             COUNT(*)::int AS report_count,
             MAX(r.created_at) AS last_report_at
      FROM anime_comment_reports r
      INNER JOIN anime_comments c ON c.id = r.comment_id AND c.is_deleted = false
      GROUP BY r.comment_id
      ORDER BY report_count DESC, last_report_at DESC
      LIMIT $1 OFFSET $2
      `,
      [safeLimit, offset],
    );

    if (ranked.length === 0) {
      return {
        items: [] as AnimeCommentReportAdminItem[],
        total,
        page: safePage,
        limit: safeLimit,
        totalPages,
      };
    }

    const commentIds = ranked.map((r) => r.comment_id);
    const comments = await this.commentsRepo.find({
      where: { id: In(commentIds) },
    });
    const commentById = new Map(comments.map((c) => [c.id, c]));

    const animeIds = [...new Set(comments.map((c) => c.animeId))];
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({ where: { id: In(animeIds) } })
        : [];
    const animeById = new Map(animes.map((a) => [a.id, a]));

    const authorIds = [
      ...new Set(comments.map((c) => String(c.telegramUserId))),
    ];
    const users =
      authorIds.length > 0
        ? await this.usersRepo.find({
            where: { telegramUserId: In(authorIds) },
          })
        : [];
    const userById = new Map(users.map((u) => [String(u.telegramUserId), u]));

    const reportRows = await this.reportsRepo.find({
      where: { commentId: In(commentIds) },
      order: { createdAt: 'DESC' },
    });
    const samplesByComment = new Map<
      string,
      AnimeCommentReportAdminItem['sample_reports']
    >();
    for (const report of reportRows) {
      const list = samplesByComment.get(report.commentId) ?? [];
      if (list.length < 5) {
        list.push({
          id: report.id,
          reason: report.reason,
          reporter_telegram_user_id: String(report.telegramUserId),
          created_at: report.createdAt.toISOString(),
        });
        samplesByComment.set(report.commentId, list);
      }
    }

    const items: AnimeCommentReportAdminItem[] = [];
    for (const row of ranked) {
      const comment = commentById.get(row.comment_id);
      if (!comment) continue;
      const anime = animeById.get(comment.animeId);
      const user = userById.get(String(comment.telegramUserId));
      items.push({
        comment_id: comment.id,
        body: comment.body,
        created_at: comment.createdAt.toISOString(),
        report_count: row.report_count,
        last_report_at: new Date(row.last_report_at).toISOString(),
        anime: {
          id: comment.animeId,
          slug: anime?.slug ?? null,
          title: anime?.title ?? '—',
        },
        author: {
          telegram_user_id: String(comment.telegramUserId),
          display_name:
            user?.socialDisplayName?.trim() ||
            user?.firstName?.trim() ||
            user?.username?.trim() ||
            'کاربر',
          photo_url: user?.photoUrl?.trim() || null,
        },
        sample_reports: samplesByComment.get(comment.id) ?? [],
      });
    }

    return {
      items,
      total,
      page: safePage,
      limit: safeLimit,
      totalPages,
    };
  }

  async removeComment(commentId: string) {
    const id = String(commentId ?? '').trim();
    const comment = await this.commentsRepo.findOne({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    comment.isDeleted = true;
    await this.commentsRepo.save(comment);
    await this.reportsRepo.delete({ commentId: id });
    return { ok: true as const };
  }

  async dismissReports(commentId: string) {
    const id = String(commentId ?? '').trim();
    const comment = await this.commentsRepo.findOne({ where: { id } });
    if (!comment) throw new NotFoundException('Comment not found');
    await this.reportsRepo.delete({ commentId: id });
    return { ok: true as const };
  }

  async getPendingModerationCount(): Promise<{ pending: number }> {
    const pending = await this.commentsRepo.count({
      where: { moderationStatus: 'pending', isDeleted: false },
    });
    return { pending };
  }

  async listForModeration(query: ListAnimeCommentsAdminQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 20));
    const status = query.status ?? 'pending';
    const search = query.search?.trim() ?? '';

    const qb = this.commentsRepo
      .createQueryBuilder('c')
      .innerJoin(Anime, 'a', 'a.id = c.anime_id')
      .where('c.is_deleted = false');

    if (status !== 'all') {
      qb.andWhere('c.moderation_status = :status', { status });
    }
    if (search) {
      qb.andWhere(
        `(c.body ILIKE :q OR a.title ILIKE :q OR CAST(c.telegram_user_id AS text) = :exact)`,
        { q: `%${search}%`, exact: search },
      );
    }
    qb.orderBy('c.created_at', 'DESC');

    const [rows, total] = await qb
      .skip((page - 1) * limit)
      .take(limit)
      .getManyAndCount();

    const animeIds = [...new Set(rows.map((r) => r.animeId))];
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({ where: { id: In(animeIds) } })
        : [];
    const animeTitleById = new Map(
      animes.map((a) => [a.id, a.title?.trim() || '—']),
    );

    const summaryRows = await this.commentsRepo
      .createQueryBuilder('c')
      .select('c.moderation_status', 'status')
      .addSelect('COUNT(*)', 'count')
      .where('c.is_deleted = false')
      .groupBy('c.moderation_status')
      .getRawMany<{ status: AnimeCommentModerationStatus; count: string }>();

    const summary = { pending: 0, approved: 0, rejected: 0 };
    for (const row of summaryRows) {
      const n = Number(row.count) || 0;
      if (row.status === 'pending') summary.pending = n;
      else if (row.status === 'approved') summary.approved = n;
      else if (row.status === 'rejected') summary.rejected = n;
    }

    const authorIds = [...new Set(rows.map((r) => String(r.telegramUserId)))];
    const users =
      authorIds.length > 0
        ? await this.usersRepo.find({
            where: { telegramUserId: In(authorIds) },
          })
        : [];
    const userById = new Map(users.map((u) => [String(u.telegramUserId), u]));

    const items = rows.map((row) => {
      const user = userById.get(String(row.telegramUserId));
      return {
        id: row.id,
        anime_id: row.animeId,
        anime_title: animeTitleById.get(row.animeId) ?? '—',
        parent_id: row.parentId,
        body: row.body,
        moderation_status: row.moderationStatus,
        created_at: row.createdAt.toISOString(),
        author: {
          telegram_user_id: String(row.telegramUserId),
          display_name:
            user?.socialDisplayName?.trim() ||
            user?.firstName?.trim() ||
            user?.username?.trim() ||
            'کاربر',
          username: user?.username?.trim() || null,
          photo_url: user?.photoUrl?.trim() || null,
        },
      };
    });

    return { items, total, page, limit, summary };
  }

  async moderateComment(
    commentId: string,
    status: 'approved' | 'rejected',
  ): Promise<{ ok: true; moderation_status: AnimeCommentModerationStatus }> {
    const id = String(commentId ?? '').trim();
    const comment = await this.commentsRepo.findOne({ where: { id } });
    if (!comment || comment.isDeleted) {
      throw new NotFoundException('Comment not found');
    }
    comment.moderationStatus = status;
    comment.moderatedAt = new Date();
    await this.commentsRepo.save(comment);
    if (status === 'approved') {
      void this.commentsService
        .deliverPublishNotificationsForComment(comment.id)
        .catch(() => undefined);
    }
    return { ok: true, moderation_status: status };
  }
}
