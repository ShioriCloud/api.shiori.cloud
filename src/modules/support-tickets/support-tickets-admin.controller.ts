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
  PortalAuthGuard,
  type PortalAuthedRequest,
} from '../portal-auth/portal-auth.guard';
import {
  ListSupportTicketsAdminQueryDto,
  ReplySupportTicketDto,
  UpdateSupportTicketStatusDto,
} from './support-tickets.dto';
import { SupportTicketsService } from './support-tickets.service';

@ApiTags('Support Tickets Admin')
@Controller('support-tickets-admin')
@UseGuards(PortalAuthGuard)
export class SupportTicketsAdminController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Get()
  @ApiOperation({ summary: 'Paginated support tickets for admin panel' })
  list(@Query() query: ListSupportTicketsAdminQueryDto) {
    return this.supportTicketsService.listAdmin({
      status: query.status,
      category: query.category,
      page: query.page,
      limit: query.limit,
      search: query.search,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Open ticket count for admin sidebar badge' })
  summary() {
    return this.supportTicketsService.getAdminOpenCount();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get support ticket detail' })
  get(@Param('id') id: string) {
    return this.supportTicketsService.getAdmin(id);
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Staff reply to support ticket' })
  reply(
    @Req() req: PortalAuthedRequest,
    @Param('id') id: string,
    @Body() body: ReplySupportTicketDto,
  ) {
    return this.supportTicketsService.replyAdmin(
      String(req.portalTelegramUserId),
      id,
      body,
    );
  }

  @Patch(':id/status')
  @ApiOperation({ summary: 'Update support ticket status' })
  updateStatus(
    @Param('id') id: string,
    @Body() body: UpdateSupportTicketStatusDto,
  ) {
    return this.supportTicketsService.updateStatusAdmin(id, body);
  }
}
