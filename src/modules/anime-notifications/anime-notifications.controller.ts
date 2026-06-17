import {
  Body,
  Controller,
  Get,
  Param,
  Patch,
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
import { UpdateNotificationPreferencesDto } from './anime-notifications.dto';
import { AnimeNotificationsService } from './anime-notifications.service';

@ApiTags('Anime Notifications')
@Controller('anime-notifications')
@UseGuards(AppUserAuthGuard)
export class AnimeNotificationsController {
  constructor(private readonly notificationsService: AnimeNotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Inbox notifications for current user' })
  list(@Req() req: AppUserAuthedRequest, @Query('limit') limit?: string) {
    const parsed = limit ? Number(limit) : 50;
    return this.notificationsService.list(
      String(req.telegramUserId),
      Number.isFinite(parsed) ? parsed : 50,
    );
  }

  @Post('read-all')
  @ApiOperation({ summary: 'Mark all notifications as read' })
  markAllRead(@Req() req: AppUserAuthedRequest) {
    return this.notificationsService.markAllRead(String(req.telegramUserId));
  }

  @Post(':id/read')
  @ApiOperation({ summary: 'Mark one notification as read' })
  markRead(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.notificationsService.markRead(String(req.telegramUserId), id);
  }

  @Get('preferences')
  @ApiOperation({ summary: 'Notification preferences' })
  getPreferences(@Req() req: AppUserAuthedRequest) {
    return this.notificationsService.getPreferences(String(req.telegramUserId));
  }

  @Patch('preferences')
  @ApiOperation({ summary: 'Update notification preferences' })
  updatePreferences(
    @Req() req: AppUserAuthedRequest,
    @Body() body: UpdateNotificationPreferencesDto,
  ) {
    return this.notificationsService.updatePreferences(
      String(req.telegramUserId),
      body,
    );
  }
}
