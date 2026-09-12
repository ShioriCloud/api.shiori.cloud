import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Put,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { PortalAuthGuard, type PortalAuthedRequest } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import { ExternalScoresService } from '../external-scores/external-scores.service';
import { normalizeExternalId } from '../../common/external-score.util';
import { AnimeAdminService } from './anime-admin.service';

@ApiTags('Anime Admin')
@Controller('anime-admin')
@UseGuards(PortalAuthGuard)
export class AnimeAdminController {
  constructor(
    private readonly animeAdminService: AnimeAdminService,
    private readonly externalScoresService: ExternalScoresService,
  ) {}

  @Get('anilist/search')
  @ApiOperation({ summary: 'Search AniList anime by title (admin)' })
  searchAnilist(@Query('q') q?: string, @Query('search') search?: string) {
    return this.animeAdminService.searchAnilist(q ?? search);
  }

  @Post('anilist/import')
  @ApiOperation({ summary: 'Import AniList anime into local catalog (admin)' })
  importAnilist(@Body() body: Record<string, unknown>, @Req() req: PortalAuthedRequest) {
    return this.animeAdminService.importFromAnilist(body, req.portalTelegramUserId);
  }

  @Get('list-stats')
  @ApiOperation({ summary: 'Anime list aggregate stats (admin)' })
  getListStats() {
    return this.animeAdminService.getAnimeListStats();
  }

  @Get('anime/ids-with-episodes')
  @ApiOperation({ summary: 'Anime IDs with at least one episode' })
  getAnimeIdsWithEpisodes() {
    return this.animeAdminService.getAnimeIdsWithEpisodes();
  }

  @Get('anime/stats')
  @ApiOperation({ summary: 'Anime list aggregate stats (admin)' })
  getAnimeListStats() {
    return this.animeAdminService.getAnimeListStats();
  }

  @Get('anime')
  @ApiOperation({ summary: 'List anime (admin)' })
  listAnime(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('filter') filter?: 'all' | 'has-episodes' | 'no-episodes' | 'featured',
    @Query('year') year?: string,
    @Query('season') season?: string,
    @Query('sortBy')
    sortBy?: 'updated_at' | 'created_at' | 'title' | 'year_desc' | 'year_asc',
  ) {
    return this.animeAdminService.listAnime({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      filter,
      year: year ? Number(year) : undefined,
      season,
      sortBy,
    });
  }

  @Get('anime/:id/genre-slugs')
  getAnimeGenreSlugs(@Param('id') id: string) {
    return this.animeAdminService.getAnimeGenreSlugs(id);
  }

  @Get('anime/:id/studio-slugs')
  getAnimeStudioSlugs(@Param('id') id: string) {
    return this.animeAdminService.getAnimeStudioSlugs(id);
  }

  @Get('anime/slug-available/:slug')
  @ApiOperation({ summary: 'Check if anime slug is available' })
  checkAnimeSlugAvailable(
    @Param('slug') slug: string,
    @Query('excludeAnimeId') excludeAnimeId?: string,
  ) {
    return this.animeAdminService.checkAnimeSlugAvailability(slug, excludeAnimeId);
  }

  @Get('anime/:id')
  getAnime(@Param('id') id: string) {
    return this.animeAdminService.getAnimeAdmin(id);
  }

  @Post('anime')
  createAnime(@Body() body: Record<string, unknown>, @Req() req: PortalAuthedRequest) {
    return this.animeAdminService.createAnime(body, req.portalTelegramUserId);
  }

  @Put('anime/:id')
  updateAnime(
    @Param('id') id: string,
    @Body() body: Record<string, unknown>,
    @Req() req: PortalAuthedRequest,
  ) {
    return this.animeAdminService.updateAnime(id, body, req.portalTelegramUserId);
  }

  @Delete('anime/:id')
  @UseGuards(PortalFullAdminGuard)
  @ApiOperation({ summary: 'Delete anime and related records (admin only)' })
  async deleteAnime(@Param('id') id: string) {
    await this.animeAdminService.deleteAnime(id);
    return { ok: true };
  }

  @Post('anime/upsert')
  upsertAnime(@Body() body: Record<string, unknown>, @Req() req: PortalAuthedRequest) {
    return this.animeAdminService.upsertAnime(body, req.portalTelegramUserId);
  }

  @Get('anime/:animeId/episodes')
  listEpisodes(@Param('animeId') animeId: string) {
    return this.animeAdminService.listEpisodes(animeId);
  }

  @Post('episodes')
  insertEpisode(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.insertEpisode(body);
  }

  @Post('anime/:animeId/channel-draft')
  @ApiOperation({
    summary: 'Queue channel post draft preview for an episode (delivered by tel-bot)',
  })
  queueChannelDraft(
    @Param('animeId') animeId: string,
    @Body() body: { episode_number?: number; episodeNumber?: number },
  ) {
    const episodeNumber = Number(body.episode_number ?? body.episodeNumber ?? 0);
    return this.animeAdminService.queueChannelDraftPreview(animeId, episodeNumber);
  }

  @Post('anime/:animeId/episodes/batch')
  insertEpisodesBatch(
    @Param('animeId') animeId: string,
    @Body() body: { episodes?: Array<Record<string, unknown>> },
  ) {
    return this.animeAdminService.insertEpisodesBatch(animeId, body.episodes ?? []);
  }

  @Put('episodes/:id')
  updateEpisode(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.updateEpisode(id, body);
  }

  @Delete('episodes/:id')
  async deleteEpisode(@Param('id') id: string) {
    await this.animeAdminService.deleteEpisode(id);
    return { ok: true };
  }

  @Put('anime/:animeId/episode-pack')
  async updateEpisodePack(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
    @Req() req: PortalAuthedRequest,
  ) {
    await this.animeAdminService.updateEpisodePack(animeId, body, req.portalTelegramUserId);
    return { ok: true };
  }

  @Get('genres')
  listGenres(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.animeAdminService.listGenres({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('genres')
  upsertGenre(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertGenre(body);
  }

  @Put('genres/:id')
  updateGenre(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertGenre({ ...body, id });
  }

  @Delete('genres/:id')
  @UseGuards(PortalFullAdminGuard)
  async deleteGenre(@Param('id') id: string) {
    await this.animeAdminService.deleteGenre({ id });
    return { ok: true };
  }

  @Get('studios')
  listStudios(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.animeAdminService.listStudios({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('studios')
  upsertStudio(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertStudio(body);
  }

  @Put('studios/:id')
  updateStudio(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertStudio({ ...body, id });
  }

  @Delete('studios/:id')
  @UseGuards(PortalFullAdminGuard)
  async deleteStudio(@Param('id') id: string) {
    await this.animeAdminService.deleteStudio(id);
    return { ok: true };
  }

  @Put('anime/:animeId/studios')
  async replaceStudios(
    @Param('animeId') animeId: string,
    @Body() body: { studio_slugs?: string[] },
  ) {
    await this.animeAdminService.replaceAnimeStudios(animeId, body.studio_slugs ?? []);
    return { ok: true };
  }

  @Get('translators')
  listTranslators(
    @Query('search') search?: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
    @Query('sortBy') sortBy?: string,
    @Query('sortOrder') sortOrder?: 'ASC' | 'DESC',
  ) {
    return this.animeAdminService.listTranslators({
      search,
      page: page ? Number(page) : undefined,
      limit: limit ? Number(limit) : undefined,
      sortBy,
      sortOrder,
    });
  }

  @Post('translators')
  upsertTranslator(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertTranslator(body);
  }

  @Put('translators/:id')
  updateTranslator(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.upsertTranslator({ ...body, id });
  }

  @Delete('translators/:id')
  @UseGuards(PortalFullAdminGuard)
  async deleteTranslator(@Param('id') id: string) {
    await this.animeAdminService.deleteTranslator(id);
    return { ok: true };
  }

  @Get('anime/:animeId/subtitles')
  listSubtitles(@Param('animeId') animeId: string) {
    return this.animeAdminService.listSubtitles(animeId);
  }

  @Post('subtitles')
  insertSubtitle(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.insertSubtitle(body);
  }

  @Post('anime/:animeId/subtitles/batch')
  insertSubtitlesBatch(
    @Param('animeId') animeId: string,
    @Body() body: { subtitles?: Array<Record<string, unknown>> },
  ) {
    return this.animeAdminService.insertSubtitlesBatch(animeId, body.subtitles ?? []);
  }

  @Put('subtitles/:id')
  updateSubtitle(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.updateSubtitle(id, body);
  }

  @Delete('subtitles/:id')
  async deleteSubtitle(@Param('id') id: string) {
    await this.animeAdminService.deleteSubtitle(id);
    return { ok: true };
  }

  @Get('anime/:animeId/subtitle-packs')
  listSubtitlePacks(@Param('animeId') animeId: string) {
    return this.animeAdminService.listSubtitlePacks(animeId);
  }

  @Post('subtitle-packs')
  insertSubtitlePack(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.insertSubtitlePack(body);
  }

  @Put('subtitle-packs/:id')
  updateSubtitlePack(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.updateSubtitlePack(id, body);
  }

  @Delete('subtitle-packs/:id')
  async deleteSubtitlePack(@Param('id') id: string) {
    await this.animeAdminService.deleteSubtitlePack(id);
    return { ok: true };
  }

  @Get('anime/:animeId/translator-links')
  listTranslatorLinks(@Param('animeId') animeId: string) {
    return this.animeAdminService.listTranslatorLinks(animeId);
  }

  @Post('translator-links')
  insertTranslatorLink(@Body() body: Record<string, unknown>) {
    return this.animeAdminService.insertTranslatorLink(body);
  }

  @Put('translator-links/:id')
  async updateTranslatorLink(@Param('id') id: string, @Body() body: Record<string, unknown>) {
    await this.animeAdminService.updateTranslatorLink(id, body);
    return { ok: true };
  }

  @Delete('translator-links/:id')
  async deleteTranslatorLink(@Param('id') id: string) {
    await this.animeAdminService.deleteTranslatorLink(id);
    return { ok: true };
  }

  @Get('anime/:animeId/series')
  getSeriesDraft(@Param('animeId') animeId: string) {
    return this.animeAdminService.getSeriesDraft(animeId);
  }

  @Put('anime/:animeId/series')
  saveSeries(@Param('animeId') animeId: string, @Body() body: Record<string, unknown>) {
    return this.animeAdminService.saveSeries(animeId, body);
  }

  @Post('anime/:animeId/sync-external-scores')
  @ApiOperation({ summary: 'Fetch and save external scores for one anime' })
  syncExternalScores(
    @Param('animeId') animeId: string,
    @Body() body: Record<string, unknown>,
  ) {
    const overrideIds: {
      anilist_id?: number | null;
      mal_id?: number | null;
    } = {};

    if (body.anilist_id !== undefined) {
      overrideIds.anilist_id = normalizeExternalId(body.anilist_id);
    }
    if (body.mal_id !== undefined) {
      overrideIds.mal_id = normalizeExternalId(body.mal_id);
    }

    return this.externalScoresService.syncAnimeById(
      animeId,
      Object.keys(overrideIds).length > 0 ? overrideIds : undefined,
    );
  }
}
