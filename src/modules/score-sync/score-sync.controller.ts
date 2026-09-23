import { Body, Controller, Get, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import { ScoreSyncService } from './score-sync.service';

@ApiTags('Score Sync Admin')
@Controller('score-sync')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class ScoreSyncController {
  constructor(private readonly scoreSyncService: ScoreSyncService) {}

  @Get()
  @ApiOperation({
    summary: 'Score sync overview (eligibility, last runs, active job, year/season filters)',
  })
  @ApiQuery({ name: 'year', required: false })
  @ApiQuery({ name: 'season', required: false })
  getOverview(
    @Query('year') year?: string,
    @Query('season') season?: string,
  ) {
    return this.scoreSyncService.getOverview({ year, season });
  }

  @Get('job')
  @ApiOperation({ summary: 'Active or last in-memory score sync job snapshot' })
  getJob() {
    return this.scoreSyncService.getJob();
  }

  @Post('start')
  @ApiOperation({
    summary: 'Start MAL or AniList score sync job (optional year/season scope)',
  })
  start(@Body() body: Record<string, unknown>) {
    return this.scoreSyncService.start(body ?? {});
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Request soft cancel of the running score sync job' })
  cancel() {
    return this.scoreSyncService.cancel();
  }
}
