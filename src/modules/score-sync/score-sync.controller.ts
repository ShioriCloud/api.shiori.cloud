import { Body, Controller, Get, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import { ScoreSyncService } from './score-sync.service';

@ApiTags('Score Sync Admin')
@Controller('score-sync')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class ScoreSyncController {
  constructor(private readonly scoreSyncService: ScoreSyncService) {}

  @Get()
  @ApiOperation({ summary: 'Score sync overview (eligibility, last runs, active job)' })
  getOverview() {
    return this.scoreSyncService.getOverview();
  }

  @Get('job')
  @ApiOperation({ summary: 'Active or last in-memory score sync job snapshot' })
  getJob() {
    return this.scoreSyncService.getJob();
  }

  @Post('start')
  @ApiOperation({ summary: 'Start MAL or AniList score sync job' })
  start(@Body() body: Record<string, unknown>) {
    return this.scoreSyncService.start(body?.source ?? body?.provider);
  }

  @Post('cancel')
  @ApiOperation({ summary: 'Request soft cancel of the running score sync job' })
  cancel() {
    return this.scoreSyncService.cancel();
  }
}
