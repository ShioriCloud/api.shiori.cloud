import { Controller, Post, Query, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { CronAuthGuard } from './cron-auth.guard';
import { ExternalScoresService } from './external-scores.service';

@ApiTags('Cron')
@Controller('cron')
export class ExternalScoresController {
  constructor(private readonly externalScoresService: ExternalScoresService) {}

  @Post('sync-external-scores')
  @UseGuards(CronAuthGuard)
  @ApiOperation({ summary: 'Batch sync AniList/MAL scores (cron)' })
  syncExternalScores(
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
    @Query('delay_ms') delayMs?: string,
  ) {
    return this.externalScoresService.syncBatch({
      limit: limit ? Number(limit) : undefined,
      offset: offset ? Number(offset) : undefined,
      delayMs: delayMs ? Number(delayMs) : undefined,
    });
  }
}
