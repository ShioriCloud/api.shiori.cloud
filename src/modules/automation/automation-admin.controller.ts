import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  Param,
  Post,
  Put,
  Query,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { AutomationService } from './automation.service';
import type { AutomationJobState } from '../../entities/automation-job.entity';

@ApiTags('Automation Admin')
@Controller('automation')
export class AutomationAdminController {
  constructor(
    private readonly automation: AutomationService,
    private readonly config: ConfigService,
  ) {}

  // ── Cron (x-cron-secret, no portal token) ───────────────────────

  @Post('sync-from-schedule-cron')
  @ApiOperation({
    summary: 'Cron: weekly schedule sync (x-cron-secret)',
  })
  @ApiHeader({ name: 'x-cron-secret', required: true })
  syncFromScheduleCron(
    @Headers('x-cron-secret') cronSecret: string | undefined,
  ) {
    this.assertCronSecret(cronSecret);
    return this.automation.syncFromWeeklySchedule();
  }

  @Post('escalate-stale-cron')
  @ApiOperation({
    summary: 'Cron: escalate stale mid-pipeline jobs (x-cron-secret)',
  })
  @ApiHeader({ name: 'x-cron-secret', required: true })
  escalateStaleCron(
    @Headers('x-cron-secret') cronSecret: string | undefined,
    @Body() body?: { older_than_minutes?: number; limit?: number },
  ) {
    this.assertCronSecret(cronSecret);
    return this.automation.escalateStaleJobs({
      olderThanMinutes: body?.older_than_minutes,
      limit: body?.limit,
    });
  }

  private assertCronSecret(cronSecret: string | undefined) {
    const expected = String(
      this.config.get<string>('cron.secret') ?? '',
    ).trim();
    const provided = String(cronSecret ?? '').trim();
    const allowDev = Boolean(this.config.get<boolean>('allowDevAuth'));
    if (expected) {
      if (provided !== expected) {
        throw new UnauthorizedException('invalid cron secret');
      }
    } else if (!allowDev) {
      throw new UnauthorizedException('CRON_SECRET not configured');
    }
  }

  // ── Portal-authenticated ────────────────────────────────────────

  @Get('overview')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Automation dashboard counters' })
  overview() {
    return this.automation.overview();
  }

  @Post('sync-from-schedule')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({
    summary:
      'Create/activate automation configs for anime on the weekly airing schedule',
  })
  syncFromSchedule() {
    return this.automation.syncFromWeeklySchedule();
  }

  @Get('subtitle-submissions')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'List subtitle submissions (ambiguous inbox)' })
  listSubmissions(
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.automation.listSubtitleSubmissions({
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('subtitle-submissions/:id/resolve')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Assign anime+episode and create/reattach job' })
  resolveSubmission(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automation.resolveSubtitleSubmission(id, body ?? {});
  }

  @Post('subtitle-submissions/:id/reject')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  rejectSubmission(@Param('id') id: string) {
    return this.automation.rejectSubtitleSubmission(id);
  }

  @Get('configs')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'List anime automation configs' })
  listConfigs(
    @Query('q') q?: string,
    @Query('status') status?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.automation.listConfigs({
      q,
      status,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Get('anime/:animeId')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Get automation config + source profile for anime' })
  getAnime(@Param('animeId') animeId: string) {
    return this.automation.getAnimeBundle(animeId);
  }

  @Put('anime/:animeId/config')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Upsert automation config' })
  putConfig(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automation.upsertConfig(animeId, body ?? {});
  }

  @Put('anime/:animeId/source-profile')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Upsert source profile' })
  putProfile(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automation.upsertSourceProfile(animeId, body ?? {});
  }

  @Get('jobs')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'List automation jobs' })
  listJobs(
    @Query('state') state?: string,
    @Query('animeId') animeId?: string,
    @Query('anime_id') animeIdSnake?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.automation.listJobs({
      state,
      animeId: animeId ?? animeIdSnake,
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
    });
  }

  @Post('jobs/bulk-retry')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Retry many jobs in a state (optional error_code)' })
  bulkRetry(@Body() body: Record<string, unknown>) {
    return this.automation.bulkRetryJobs({
      state: body?.state != null ? String(body.state) : undefined,
      error_code:
        body?.error_code != null
          ? String(body.error_code)
          : body?.errorCode != null
            ? String(body.errorCode)
            : undefined,
      limit: body?.limit != null ? Number(body.limit) : undefined,
    });
  }

  @Get('jobs/:id')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Job detail + events' })
  getJob(@Param('id') id: string) {
    return this.automation.getJob(id);
  }

  @Post('jobs/manual')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Create manual processing job' })
  createManual(@Body() body: Record<string, unknown>) {
    return this.automation.createManualJob(body ?? {});
  }

  @Post('jobs/:id/cancel')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  cancel(@Param('id') id: string) {
    return this.automation.cancelJob(id);
  }

  @Delete('jobs/:id')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({ summary: 'Delete job from list (hard remove)' })
  deleteJob(@Param('id') id: string) {
    return this.automation.deleteJob(id);
  }

  @Post('jobs/:id/retry')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  retry(@Param('id') id: string) {
    return this.automation.retryJob(id);
  }

  @Post('jobs/:id/request-publish')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  @ApiOperation({
    summary: 'Queue channel publish for tel-bot (AWAITING_APPROVAL jobs)',
  })
  requestPublish(@Param('id') id: string) {
    return this.automation.requestPublish(id);
  }

  @Post('jobs/:id/select-release')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  selectRelease(
    @Param('id') id: string,
    @Body()
    body: {
      release_name?: string;
      magnet?: string;
      torrent_hash?: string;
    },
  ) {
    return this.automation.selectRelease(id, body ?? {});
  }

  @Post('jobs/:id/transition')
  @UseGuards(PortalAuthGuard)
  @ApiHeader({ name: 'x-portal-token', required: true })
  transition(
    @Param('id') id: string,
    @Body() body: { state?: AutomationJobState; message?: string },
  ) {
    return this.automation.transitionJob(id, body.state as AutomationJobState, {
      message: body.message,
    });
  }
}
