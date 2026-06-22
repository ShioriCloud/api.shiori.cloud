import {
  Body,
  Controller,
  Get,
  Param,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import {
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

  @Put(':id')
  @ApiOperation({ summary: 'Update telegram user admin fields' })
  async update(
    @Param('id') id: string,
    @Body() body: UpdateTelegramUserAdminDto,
  ) {
    await this.adminService.updateUser(id, body);
    return { ok: true };
  }
}
