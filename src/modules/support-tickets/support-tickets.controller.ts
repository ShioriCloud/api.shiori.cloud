import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  type AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
} from './support-tickets.dto';
import { SupportTicketsService } from './support-tickets.service';

@ApiTags('Support Tickets')
@Controller('support-tickets')
@UseGuards(AppUserAuthGuard)
export class SupportTicketsController {
  constructor(private readonly supportTicketsService: SupportTicketsService) {}

  @Get()
  @ApiOperation({ summary: 'List my support tickets' })
  list(@Req() req: AppUserAuthedRequest) {
    return this.supportTicketsService.listMine(String(req.telegramUserId));
  }

  @Get(':id')
  @ApiOperation({ summary: 'Get one of my support tickets' })
  get(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.supportTicketsService.getMine(String(req.telegramUserId), id);
  }

  @Post()
  @ApiOperation({ summary: 'Create a support ticket' })
  create(
    @Req() req: AppUserAuthedRequest,
    @Body() body: CreateSupportTicketDto,
  ) {
    return this.supportTicketsService.createMine(
      String(req.telegramUserId),
      body,
    );
  }

  @Post(':id/messages')
  @ApiOperation({ summary: 'Reply to my support ticket' })
  reply(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Body() body: ReplySupportTicketDto,
  ) {
    return this.supportTicketsService.replyMine(
      String(req.telegramUserId),
      id,
      body,
    );
  }
}
