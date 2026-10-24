import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { CreateAnimeCommentDto, ReportAnimeCommentDto } from './anime-comments.dto';
import { AnimeCommentsService } from './anime-comments.service';

const parsePage = (page?: string, limit?: string, fallbackLimit = 20) => {
  const pageNum = page ? parseInt(page, 10) : 1;
  const limitNum = limit ? parseInt(limit, 10) : fallbackLimit;
  return {
    page: Number.isFinite(pageNum) ? pageNum : 1,
    limit: Number.isFinite(limitNum) ? limitNum : fallbackLimit,
  };
};

@ApiTags('Anime Comments')
@Controller('anime-comments')
@UseGuards(AppUserAuthGuard)
export class AnimeCommentsController {
  constructor(private readonly comments: AnimeCommentsService) {}

  @Get('access')
  @ApiOperation({ summary: 'Whether comments are enabled for the viewer' })
  access(@Req() req: AppUserAuthedRequest) {
    return this.comments.access(String(req.telegramUserId));
  }

  @Get('me')
  @ApiOperation({ summary: 'Comments written by the current user' })
  me(
    @Req() req: AppUserAuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parsePage(page, limit);
    return this.comments.listMine(String(req.telegramUserId), p, l);
  }

  @Get('anime/:animeId')
  @ApiOperation({ summary: 'List comments or replies for an anime' })
  list(
    @Req() req: AppUserAuthedRequest,
    @Param('animeId') animeId: string,
    @Query('parent_id') parentId?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parsePage(page, limit);
    return this.comments.list(
      String(req.telegramUserId),
      animeId,
      parentId,
      p,
      l,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a comment or reply' })
  create(@Req() req: AppUserAuthedRequest, @Body() body: CreateAnimeCommentDto) {
    return this.comments.create(String(req.telegramUserId), body);
  }

  @Post(':id/like')
  @ApiOperation({ summary: 'Like a comment' })
  like(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.comments.like(String(req.telegramUserId), id);
  }

  @Delete(':id/like')
  @ApiOperation({ summary: 'Unlike a comment' })
  unlike(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.comments.unlike(String(req.telegramUserId), id);
  }

  @Post(':id/report')
  @ApiOperation({ summary: 'Report a comment' })
  report(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Body() body?: ReportAnimeCommentDto,
  ) {
    return this.comments.report(String(req.telegramUserId), id, body?.reason);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Soft-delete own comment' })
  remove(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.comments.remove(String(req.telegramUserId), id);
  }
}
