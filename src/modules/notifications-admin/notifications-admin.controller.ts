import { Body, Controller, Get, Post, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  PortalAuthGuard,
  PortalAuthedRequest,
} from '../portal-auth/portal-auth.guard';
import {
  ListNotificationCampaignsQueryDto,
  NotifyEpisodeReleaseDto,
} from './notifications-admin.dto';
import { NotificationsAdminService } from './notifications-admin.service';

@ApiTags('Notifications Admin')
@Controller('notifications-admin')
@UseGuards(PortalAuthGuard)
export class NotificationsAdminController {
  constructor(private readonly notificationsAdminService: NotificationsAdminService) {}

  @Get('campaigns')
  @ApiOperation({ summary: 'List recent notification campaigns' })
  listCampaigns(@Query() query: ListNotificationCampaignsQueryDto) {
    return this.notificationsAdminService.listCampaigns(query);
  }

  @Post('notify-episode')
  @ApiOperation({ summary: 'Notify users about a new episode release' })
  notifyEpisodeRelease(
    @Req() req: PortalAuthedRequest,
    @Body() body: NotifyEpisodeReleaseDto,
  ) {
    return this.notificationsAdminService.notifyEpisodeRelease(
      body,
      req.portalTelegramUserId,
    );
  }
}
