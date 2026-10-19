import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { AutomationService } from './automation.service';
import type { AutomationJobState } from '../../entities/automation-job.entity';

@ApiTags('Automation Admin')
@Controller('automation')
@UseGuards(PortalAuthGuard)
@ApiHeader({ name: 'x-portal-token', required: true })
export class AutomationAdminController {
  constructor(private readonly automation: AutomationService) {}

  @Get('overview')
  @ApiOperation({ summary: 'Automation dashboard counters' })
  overview() {
    return this.automation.overview();
  }

  @Get('configs')
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
  @ApiOperation({ summary: 'Get automation config + source profile for anime' })
  getAnime(@Param('animeId') animeId: string) {
    return this.automation.getAnimeBundle(animeId);
  }

  @Put('anime/:animeId/config')
  @ApiOperation({ summary: 'Upsert automation config' })
  putConfig(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automation.upsertConfig(animeId, body ?? {});
  }

  @Put('anime/:animeId/source-profile')
  @ApiOperation({ summary: 'Upsert source profile' })
  putProfile(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    return this.automation.upsertSourceProfile(animeId, body ?? {});
  }

  @Get('jobs')
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

  @Get('jobs/:id')
  @ApiOperation({ summary: 'Job detail + events' })
  getJob(@Param('id') id: string) {
    return this.automation.getJob(id);
  }

  @Post('jobs/manual')
  @ApiOperation({ summary: 'Create manual processing job' })
  createManual(@Body() body: Record<string, unknown>) {
    return this.automation.createManualJob(body ?? {});
  }

  @Post('jobs/:id/cancel')
  cancel(@Param('id') id: string) {
    return this.automation.cancelJob(id);
  }

  @Post('jobs/:id/retry')
  retry(@Param('id') id: string) {
    return this.automation.retryJob(id);
  }

  @Post('jobs/:id/select-release')
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
  transition(
    @Param('id') id: string,
    @Body() body: { state?: AutomationJobState; message?: string },
  ) {
    return this.automation.transitionJob(id, body.state as AutomationJobState, {
      message: body.message,
    });
  }
}
