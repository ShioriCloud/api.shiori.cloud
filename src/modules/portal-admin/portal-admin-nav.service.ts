import { Injectable } from '@nestjs/common';
import { AnimeCommentsAdminService } from '../anime-comments/anime-comments-admin.service';
import { SupportTicketsService } from '../support-tickets/support-tickets.service';

export type PortalAdminNavBadges = {
  support_open: number;
  anime_comments_pending: number;
  anime_comment_reports_pending: number;
};

@Injectable()
export class PortalAdminNavService {
  constructor(
    private readonly supportTicketsService: SupportTicketsService,
    private readonly animeCommentsAdminService: AnimeCommentsAdminService,
  ) {}

  async getNavBadges(): Promise<PortalAdminNavBadges> {
    const [support, comments, reports] = await Promise.all([
      this.supportTicketsService.getAdminOpenCount(),
      this.animeCommentsAdminService.getPendingModerationCount(),
      this.animeCommentsAdminService.getPendingReportedCommentCount(),
    ]);
    return {
      support_open: support.open ?? 0,
      anime_comments_pending: comments.pending ?? 0,
      anime_comment_reports_pending: reports.pending ?? 0,
    };
  }
}
