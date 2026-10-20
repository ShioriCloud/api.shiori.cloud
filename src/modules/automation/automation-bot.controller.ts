import { Body, Controller, Get, Param, Post, Query, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BotAuthGuard } from '../bot/bot-auth.guard';
import { AutomationService } from './automation.service';
import type { AutomationJobState } from '../../entities/automation-job.entity';

@ApiTags('Automation Bot/Worker')
@Controller('bot/automation')
@UseGuards(BotAuthGuard)
@ApiHeader({ name: 'x-bot-token', required: true })
export class AutomationBotController {
  constructor(private readonly automation: AutomationService) {}

  @Post('subtitle-submissions')
  @ApiOperation({ summary: 'Ingest translator subtitle from tel-bot' })
  ingestSubtitle(@Body() body: Record<string, unknown>) {
    return this.automation.ingestSubtitleSubmission(body ?? {});
  }

  @Get('jobs/claim')
  @ApiOperation({ summary: 'Windows worker claims runnable jobs' })
  claim(
    @Query('workerId') workerId?: string,
    @Query('worker_id') workerIdSnake?: string,
    @Query('limit') limit?: string,
  ) {
    return this.automation.claimJobs(
      String(workerId ?? workerIdSnake ?? 'softsub-worker'),
      limit ? Number(limit) : undefined,
    );
  }

  @Get('jobs/pending-publish')
  @ApiOperation({
    summary: 'Tel-bot: claim dash-requested channel publishes',
  })
  pendingPublish(@Query('limit') limit?: string) {
    return this.automation.claimPendingPublish(
      limit ? Number(limit) : undefined,
    );
  }

  @Get('jobs/pending-status')
  @ApiOperation({
    summary: 'Tel-bot: live status cards to send or edit',
  })
  pendingStatus(@Query('limit') limit?: string) {
    return this.automation.listPendingLiveStatus(
      limit ? Number(limit) : undefined,
    );
  }

  @Post('jobs/:id/ack-status')
  @ApiOperation({
    summary: 'Tel-bot: ack live status message ids after send/edit',
  })
  ackStatus(
    @Param('id') id: string,
    @Body()
    body: {
      rev?: number;
      messages?: Record<string, number | string>;
    },
  ) {
    return this.automation.ackLiveStatus(id, body ?? {});
  }

  @Post('jobs/:id/progress')
  @ApiOperation({ summary: 'Worker progress / state update' })
  progress(
    @Param('id') id: string,
    @Body()
    body: {
      state?: AutomationJobState;
      message?: string;
      progress?: Record<string, unknown>;
      error_message?: string;
      error_code?: string;
      selected_release_name?: string;
      selected_magnet?: string;
      torrent_hash?: string;
      download_path?: string;
      output_path?: string;
      output_file_name?: string;
      archive_file_key?: string;
      download_link?: string;
      release_candidates?: unknown[];
      create_draft?: boolean;
    },
  ) {
    return this.automation.workerProgress(id, body ?? {});
  }

  @Get('jobs/:id')
  getJob(@Param('id') id: string) {
    return this.automation.getJob(id);
  }
}
