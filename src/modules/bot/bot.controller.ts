import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { BotAuthGuard } from './bot-auth.guard';
import {
  BotArchiveLinkResponseDto,
  BotDeactivateCountResponseDto,
  BotDownloadVisitorDto,
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
import { ChannelDraftsService } from './channel-drafts.service';
import { TelegramDmOutboxService } from '../telegram-dm/telegram-dm-outbox.service';

@ApiTags('Bot')
@Controller('bot')
@UseGuards(BotAuthGuard)
@ApiHeader({ name: 'x-bot-token', required: true })
export class BotController {
  constructor(
    private readonly botService: BotService,
    private readonly sponsorCampaigns: SponsorCampaignsService,
    private readonly channelDrafts: ChannelDraftsService,
    private readonly telegramDmOutbox: TelegramDmOutboxService,
  ) {}

  @Get('health')
  @ApiOperation({ summary: 'Health check for tel-bot startup' })
  health(): BotOkResponseDto {
    return this.botService.health();
  }

  @Get('telegram-dm/pending')
  @ApiOperation({
    summary:
      'Claim pending Telegram DMs for tel-bot delivery (API cannot reach Telegram)',
  })
  @ApiQuery({ name: 'limit', required: false })
  listPendingTelegramDms(@Query('limit') limit?: string) {
    return this.telegramDmOutbox.claimPending(
      limit ? Number(limit) : undefined,
    );
  }

  @Post('telegram-dm/ack')
  @ApiOperation({ summary: 'Ack Telegram DM send results from tel-bot' })
  ackTelegramDms(
    @Body()
    body: {
      results?: Array<{ id?: string; ok?: boolean; error?: string | null }>;
    },
  ) {
    const results = Array.isArray(body?.results) ? body.results : [];
    return this.telegramDmOutbox.ackResults(
      results.map((row) => ({
        id: String(row.id ?? ''),
        ok: Boolean(row.ok),
        error: row.error ?? null,
      })),
    );
  }

  @Get('archive-links/:code')
  @ApiOperation({ summary: 'Resolve an archive file link by code (tel-bot)' })
  getArchiveLink(
    @Param('code') code: string,
  ): Promise<BotArchiveLinkResponseDto> {
    return this.botService.getArchiveLinkByCode(code);
  }

  @Get('files/by-message/:messageId')
  @ApiOperation({
    summary: 'Get file by Telegram message id (active or inactive)',
  })
  getFileByMessageId(
    @Param('messageId') messageId: string,
  ): Promise<BotFileResponseDto> {
    return this.botService.getFileByMessageId(messageId);
  }

  @Get('files/by-name')
  @ApiOperation({
    summary: 'Get latest active file by exact file_name (softsub worker)',
  })
  @ApiQuery({ name: 'fileName', required: false })
  @ApiQuery({ name: 'file_name', required: false })
  getFileByName(
    @Query('fileName') fileName?: string,
    @Query('file_name') fileNameSnake?: string,
  ): Promise<BotFileResponseDto> {
    return this.botService.getFileByFileName(
      String(fileName ?? fileNameSnake ?? ''),
    );
  }

  @Get('files/:key')
  @ApiOperation({ summary: 'Get active file by key' })
  getFile(@Param('key') key: string): Promise<BotFileResponseDto> {
    return this.botService.getFileByKey(key);
  }

  @Post('softsub/complete')
  @ApiOperation({
    summary:
      'Attach softsub download link to episode and queue channel draft (softsub worker)',
  })
  softsubComplete(
    @Body()
    body: {
      anime_id?: string;
      animeId?: string;
      anime_slug?: string;
      animeSlug?: string;
      filename_title?: string;
      filenameTitle?: string;
      episode_number?: number;
      episodeNumber?: number;
      download_link?: string;
      downloadLink?: string;
      create_draft?: boolean;
      createDraft?: boolean;
    },
  ) {
    return this.channelDrafts.completeSoftsub(body);
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
  @ApiOperation({
    summary: 'Increment download counter and record the Telegram visitor',
  })
  incrementDownloads(
    @Param('key') key: string,
    @Body() body?: BotDownloadVisitorDto,
  ): Promise<BotFileResponseDto> {
    return this.botService.incrementDownloads(key, body);
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
  getPackItems(
    @Param('packId') packId: string,
  ): Promise<BotPackItemsResponseDto> {
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
  deleteSetting(
    @Param('key') key: string,
  ): Promise<BotSettingDeletedResponseDto> {
    return this.botService.deleteSetting(key);
  }

  @Get('sponsor-campaigns/active')
  @ApiOperation({
    summary: 'List active sponsor campaigns for membership gate',
  })
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

  @Get('anime/search')
  @ApiOperation({ summary: 'Search catalog anime for channel template bind' })
  @ApiQuery({ name: 'q', required: true })
  @ApiQuery({ name: 'limit', required: false })
  searchAnime(
    @Query('q') q?: string,
    @Query('query') query?: string,
    @Query('limit') limit?: string,
  ) {
    return this.channelDrafts.searchAnime(
      String(q ?? query ?? ''),
      limit ? Number(limit) : undefined,
    );
  }

  @Post('channel-posts/mini-app-markup')
  @ApiOperation({
    summary: 'Resolve mini-app keyboard for a channel post caption/origin',
  })
  resolveMiniAppMarkup(
    @Body()
    body: {
      caption?: string;
      origin_channel_id?: string;
      originChannelId?: string;
      origin_message_id?: string | number;
      originMessageId?: string | number;
    },
  ) {
    return this.channelDrafts.resolveMiniAppMarkup(body);
  }

  @Put('anime/:idOrSlug/channel-template')
  @ApiOperation({ summary: 'Bind channel post template to catalog anime' })
  bindChannelTemplate(
    @Param('idOrSlug') idOrSlug: string,
    @Body()
    body: {
      cover_file_id?: string;
      coverFileId?: string;
      caption_html?: string;
      captionHtml?: string;
      caption_text?: string;
      captionText?: string;
      caption_entities?: Array<{
        type: string;
        offset: number;
        length: number;
        url?: string;
        custom_emoji_id?: string;
        customEmojiId?: string;
      }>;
      captionEntities?: Array<{
        type: string;
        offset: number;
        length: number;
        url?: string;
        custom_emoji_id?: string;
        customEmojiId?: string;
      }>;
      channel_id?: string;
      channelId?: string;
      channel_message_id?: number | string;
      channelMessageId?: number | string;
    },
  ) {
    return this.channelDrafts.bindTemplate({
      animeIdOrSlug: idOrSlug,
      coverFileId: body.cover_file_id ?? body.coverFileId ?? '',
      captionHtml: body.caption_html ?? body.captionHtml,
      captionText: body.caption_text ?? body.captionText,
      captionEntities: body.caption_entities ?? body.captionEntities,
      channelId: body.channel_id ?? body.channelId ?? '',
      channelMessageId: body.channel_message_id ?? body.channelMessageId,
    });
  }

  @Post('channel-drafts/from-episode')
  @ApiOperation({ summary: 'Create channel post draft from a catalog episode' })
  createDraftFromEpisode(
    @Body()
    body: {
      anime_id?: string;
      animeId?: string;
      episode_number?: number;
      episodeNumber?: number;
    },
  ) {
    const animeId = String(body.anime_id ?? body.animeId ?? '').trim();
    const episodeNumber = Number(
      body.episode_number ?? body.episodeNumber ?? 0,
    );
    return this.channelDrafts.createFromEpisode(animeId, episodeNumber);
  }

  @Get('channel-drafts/pending-preview')
  @ApiOperation({
    summary: 'List channel drafts waiting for bot to send admin preview DM',
  })
  @ApiQuery({ name: 'limit', required: false })
  listPendingPreviews(@Query('limit') limit?: string) {
    return this.channelDrafts.listPendingPreviews(
      limit ? Number(limit) : undefined,
    );
  }

  @Post('channel-drafts/clear-pending')
  @ApiOperation({
    summary:
      'Reject all pending drafts still waiting for preview DM (clear bot queue)',
  })
  clearPendingPreviews() {
    return this.channelDrafts.clearPendingPreviews();
  }

  @Get('channel-drafts/:id')
  @ApiOperation({ summary: 'Get channel post draft' })
  getChannelDraft(@Param('id') id: string) {
    return this.channelDrafts.getDraft(id);
  }

  @Post('channel-drafts/:id/ack-preview')
  @ApiOperation({ summary: 'Ack that tel-bot delivered the admin preview DM' })
  ackChannelDraftPreview(
    @Param('id') id: string,
    @Body()
    body: {
      chat_id?: string | number;
      chatId?: string | number;
      message_id?: string | number;
      messageId?: string | number;
    },
  ) {
    return this.channelDrafts.ackPreview(id, body);
  }

  @Post('channel-drafts/:id/mark-published')
  @ApiOperation({
    summary: 'Mark draft published after tel-bot sent the channel post',
  })
  markChannelDraftPublished(
    @Param('id') id: string,
    @Body()
    body: {
      published_message_id?: string | number;
      publishedMessageId?: string | number;
      channel_id?: string;
      channelId?: string;
    },
  ) {
    return this.channelDrafts.markPublished(id, body);
  }

  @Post('channel-drafts/:id/publish')
  @ApiOperation({
    summary:
      'Prepare channel draft publish payload for tel-bot (does not call Telegram)',
  })
  publishChannelDraft(
    @Param('id') id: string,
    @Body()
    body?: {
      channel_id?: string;
      channelId?: string;
    },
  ) {
    return this.channelDrafts.publishDraft(id, body);
  }

  @Post('channel-drafts/:id/reject')
  @ApiOperation({ summary: 'Reject channel post draft' })
  rejectChannelDraft(@Param('id') id: string) {
    return this.channelDrafts.rejectDraft(id);
  }
}
