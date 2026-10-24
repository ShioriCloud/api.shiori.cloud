import {
  Controller,
  Delete,
  Get,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { ListAnimeCommentReportsAdminQueryDto } from './anime-comments-admin.dto';
import { AnimeCommentsAdminService } from './anime-comments-admin.service';

@ApiTags('Anime Comments Admin')
@Controller('anime-comments-admin')
@UseGuards(PortalAuthGuard)
export class AnimeCommentsAdminController {
  constructor(private readonly admin: AnimeCommentsAdminService) {}

  @Get('reports/summary')
  @ApiOperation({ summary: 'Count of comments with open reports' })
  reportsSummary() {
    return this.admin.getPendingReportedCommentCount();
  }

  @Get('reports')
  @ApiOperation({ summary: 'Paginated reported anime comments for admin panel' })
  listReports(@Query() query: ListAnimeCommentReportsAdminQueryDto) {
    return this.admin.listReportedComments(query.page ?? 1, query.limit ?? 20);
  }

  @Delete('comments/:id')
  @ApiOperation({ summary: 'Soft-delete comment and clear reports' })
  removeComment(@Param('id') id: string) {
    return this.admin.removeComment(id);
  }

  @Delete('comments/:id/reports')
  @ApiOperation({ summary: 'Dismiss all reports without deleting comment' })
  dismissReports(@Param('id') id: string) {
    return this.admin.dismissReports(id);
  }
}
