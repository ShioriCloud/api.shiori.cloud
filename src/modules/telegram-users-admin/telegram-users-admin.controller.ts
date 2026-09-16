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
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import {
  BanTelegramUserDto,
  ListTelegramUsersQueryDto,
  UpdateTelegramUserAdminDto,
} from './telegram-users-admin.dto';
import { TelegramUsersAdminService } from './telegram-users-admin.service';

@ApiTags('Telegram Users Admin')
@Controller('telegram-users-admin')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class TelegramUsersAdminController {
  constructor(private readonly adminService: TelegramUsersAdminService) {}

  @Get('overview')
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
  ) {
    await this.adminService.updateUser(id, body);
    return { ok: true };
  }

  @Post(':id/ban')
  @ApiOperation({ summary: 'Ban user from mini-app and revoke sessions' })
  ban(@Param('id') id: string, @Body() body: BanTelegramUserDto) {
    return this.adminService.banUser(id, body);
  }

  @Post(':id/unban')
  @ApiOperation({ summary: 'Clear mini-app ban' })
  unban(@Param('id') id: string) {
    return this.adminService.unbanUser(id);
  }

  @Post(':id/revoke-sessions')
  @ApiOperation({ summary: 'Revoke all portal/mini-app sessions for user' })
  revokeSessions(@Param('id') id: string) {
    return this.adminService.revokeSessions(id);
  }
}
