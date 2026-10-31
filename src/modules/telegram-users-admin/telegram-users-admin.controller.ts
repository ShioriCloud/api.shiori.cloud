import {
  Body,
  Controller,
  Get,
  Header,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import {
  BanTelegramUserDto,
  ListAdminAuditEventsQueryDto,
  ListTelegramUsersQueryDto,
  UpdateTelegramUserAdminDto,
} from './telegram-users-admin.dto';
import { TelegramUsersAdminService } from './telegram-users-admin.service';

type PortalRequest = {
  portalTelegramUserId?: string;
};

@ApiTags('Telegram Users Admin')
@Controller('telegram-users-admin')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class TelegramUsersAdminController {
  constructor(private readonly adminService: TelegramUsersAdminService) {}

  @Get('overview')
  @Header('Cache-Control', 'private, no-cache, no-store, must-revalidate')
  @ApiOperation({ summary: 'Admin dashboard stats for telegram users' })
  overview() {
    return this.adminService.getOverview();
  }

  @Get()
  @ApiOperation({ summary: 'Paginated telegram users for admin panel' })
  list(@Query() query: ListTelegramUsersQueryDto) {
    return this.adminService.listUsers(query);
  }

  @Get('export')
  @ApiOperation({ summary: 'Export filtered telegram users as CSV' })
  async export(@Query() query: ListTelegramUsersQueryDto) {
    const csv = await this.adminService.exportCsv(query);
    return { csv };
  }

  @Get('audit-events')
  @ApiOperation({ summary: 'Paginated staff audit trail across users' })
  listAuditEvents(@Query() query: ListAdminAuditEventsQueryDto) {
    return this.adminService.listAuditEvents(query);
  }

  @Get(':id/social-summary')
  @ApiOperation({ summary: 'Social follow/block/mute counts for a user' })
  socialSummary(@Param('id') id: string) {
    return this.adminService.getSocialSummary(id);
  }

  @Get(':id/followers')
  @ApiOperation({ summary: 'Paginated followers for admin user detail' })
  socialFollowers(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listSocialFollowers(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id/following')
  @ApiOperation({ summary: 'Paginated following for admin user detail' })
  socialFollowing(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listSocialFollowing(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id/blocks')
  @ApiOperation({ summary: 'Outgoing social blocks for admin user detail' })
  socialBlocks(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listSocialBlocksOut(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id/mutes')
  @ApiOperation({ summary: 'Outgoing social mutes for admin user detail' })
  socialMutes(
    @Param('id') id: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    return this.adminService.listSocialMutesOut(
      id,
      page ? parseInt(page, 10) : 1,
      limit ? parseInt(limit, 10) : 30,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Aggregated telegram user detail for admin' })
  getOne(@Param('id') id: string) {
    return this.adminService.getUserDetail(id);
  }

  @Put(':id')
  @ApiOperation({ summary: 'Update telegram user admin fields' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTelegramUserAdminDto,
    @Req() req: PortalRequest,
  ) {
    await this.adminService.updateUser(id, body, req.portalTelegramUserId);
    return { ok: true };
  }

  @Post(':id/ban')
  @ApiOperation({ summary: 'Ban user from mini-app and revoke sessions' })
  ban(
    @Param('id') id: string,
    @Body() body: BanTelegramUserDto,
    @Req() req: PortalRequest,
  ) {
    return this.adminService.banUser(id, body, req.portalTelegramUserId);
  }

  @Post(':id/unban')
  @ApiOperation({ summary: 'Clear mini-app ban' })
  unban(@Param('id') id: string, @Req() req: PortalRequest) {
    return this.adminService.unbanUser(id, req.portalTelegramUserId);
  }

  @Post(':id/revoke-sessions')
  @ApiOperation({ summary: 'Revoke all portal/mini-app sessions for user' })
  revokeSessions(@Param('id') id: string, @Req() req: PortalRequest) {
    return this.adminService.revokeSessions(id, req.portalTelegramUserId);
  }
}
