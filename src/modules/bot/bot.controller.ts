import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BotAuthGuard } from './bot-auth.guard';
import {
  BotArchiveLinkResponseDto,
  BotDeactivateCountResponseDto,
  BotFileResponseDto,
  BotModifiedCountResponseDto,
  BotOkResponseDto,
  BotPackItemsResponseDto,
  BotPackResponseDto,
  BotSettingDeletedResponseDto,
  BotSettingResponseDto,
  CreateBotFileDto,
  SetBotSettingDto,
  UpdateBotFileByMessageDto,
  UpsertBotFileDto,
} from './bot.dto';
import { AttributeSponsorJoinDto } from '../sponsor-campaigns/sponsor-campaigns.dto';
import { SponsorCampaignsService } from '../sponsor-campaigns/sponsor-campaigns.service';
import { BotService } from './bot.service';

@ApiTags('Bot')
@Controller('bot')
@UseGuards(BotAuthGuard)
@ApiHeader({ name: 'x-bot-token', required: true })
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly sponsorCampaigns: SponsorCampaignsService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check for tel-bot startup' })
  health(): BotOkResponseDto {
    return this.botService.health();
  }

  @Get('archive-links/:code')
  @ApiOperation({ summary: 'Resolve an archive file link by code (tel-bot)' })
  getArchiveLink(@Param('code') code: string): Promise<BotArchiveLinkResponseDto> {
    return this.botService.getArchiveLinkByCode(code);
  }

  @Get('files/by-message/:messageId')
  @ApiOperation({ summary: 'Get file by Telegram message id (active or inactive)' })
  getFileByMessageId(@Param('messageId') messageId: string): Promise<BotFileResponseDto> {
    return this.botService.getFileByMessageId(messageId);
  }

  @Get('files/:key')
  @ApiOperation({ summary: 'Get active file by key' })
  getFile(@Param('key') key: string): Promise<BotFileResponseDto> {
    return this.botService.getFileByKey(key);
  }

  @Post('files')
  @ApiOperation({ summary: 'Create a new file record' })
  createFile(@Body() dto: CreateBotFileDto): Promise<BotFileResponseDto> {
    return this.botService.createFile(dto);
  }

  @Put('files/:key')
  @ApiOperation({ summary: 'Upsert file by key (reindex script)' })
  upsertFile(
    @Param('key') key: string,
    @Body() dto: UpsertBotFileDto,
  ): Promise<BotFileResponseDto> {
    return this.botService.upsertFile(key, dto);
  }

  @Post('files/:key/downloads')
  @ApiOperation({ summary: 'Increment download counter' })
  incrementDownloads(@Param('key') key: string): Promise<BotFileResponseDto> {
    return this.botService.incrementDownloads(key);
  }

  @Patch('files/by-message/:messageId')
  @ApiOperation({ summary: 'Update file fields by Telegram message id' })
  updateByMessageId(
    @Param('messageId') messageId: string,
    @Body() dto: UpdateBotFileByMessageDto,
  ): Promise<BotModifiedCountResponseDto> {
    return this.botService.updateByMessageId(messageId, dto);
  }

  @Post('files/by-message/:messageId/deactivate')
  @ApiOperation({ summary: 'Deactivate all files linked to a message id' })
  deactivateByMessageId(
    @Param('messageId') messageId: string,
  ): Promise<BotDeactivateCountResponseDto> {
    return this.botService.deactivateByMessageId(messageId);
  }

  @Get('packs/:packId/items')
  @ApiOperation({ summary: 'List items in a file pack' })
  getPackItems(@Param('packId') packId: string): Promise<BotPackItemsResponseDto> {
    return this.botService.getPackItems(packId);
  }

  @Get('packs/:slug')
  @ApiOperation({ summary: 'Get file pack by slug' })
  getPack(@Param('slug') slug: string): Promise<BotPackResponseDto> {
    return this.botService.getPackBySlug(slug);
  }

  @Get('settings/:key')
  @ApiOperation({ summary: 'Get bot setting value' })
  getSetting(@Param('key') key: string): Promise<BotSettingResponseDto> {
    return this.botService.getSetting(key);
  }

  @Put('settings/:key')
  @ApiOperation({ summary: 'Set bot setting value' })
  setSetting(
    @Param('key') key: string,
    @Body() dto: SetBotSettingDto,
  ): Promise<BotOkResponseDto> {
    return this.botService.setSetting(key, dto.value);
  }

  @Delete('settings/:key')
  @ApiOperation({ summary: 'Delete bot setting' })
  deleteSetting(@Param('key') key: string): Promise<BotSettingDeletedResponseDto> {
    return this.botService.deleteSetting(key);
  }

  @Get('sponsor-campaigns/active')
  @ApiOperation({ summary: 'List active sponsor campaigns for membership gate' })
  listActiveSponsorCampaigns() {
    return this.sponsorCampaigns.listActiveCampaigns();
  }

  @Post('sponsor-campaigns/:id/attribute-join')
  @ApiOperation({ summary: 'Attribute a verified channel join to a campaign' })
  attributeSponsorJoin(
    @Param('id') id: string,
    @Body() body: AttributeSponsorJoinDto,
  ) {
    return this.sponsorCampaigns.attributeJoin(id, body);
  }
}
