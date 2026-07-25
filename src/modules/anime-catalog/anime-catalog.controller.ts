import { Controller, Get, HttpCode, Param, Post, Query } from '@nestjs/common';

import { ApiOperation, ApiTags } from '@nestjs/swagger';

import {
  AnimeCatalogService,
  AnimeSearchParams,
} from './anime-catalog.service';

@ApiTags('Anime Catalog')
@Controller('anime-catalog')
export class AnimeCatalogController {
  constructor(private readonly animeCatalogService: AnimeCatalogService) {}

  @Get('featured')
  @ApiOperation({ summary: 'Featured anime for home slider' })
  listFeatured(@Query('limit') limit?: number) {
    return this.animeCatalogService.listFeatured(limit ? Number(limit) : 10);
  }

  @Get('popular')
  @ApiOperation({ summary: 'Popular anime by view count' })
  listPopular(@Query('limit') limit?: number) {
    return this.animeCatalogService.listPopular(limit ? Number(limit) : 20);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recently added anime' })
  listRecent(@Query('limit') limit?: number) {
    return this.animeCatalogService.listRecent(limit ? Number(limit) : 20);
  }

  @Get('schedule')
  @ApiOperation({ summary: 'Weekly airing schedule (AniList + local ids)' })
  listSchedule() {
    return this.animeCatalogService.listAiringSchedule();
  }

  @Get('all')
  @ApiOperation({ summary: 'Full anime catalog (cards)' })
  listAll() {
    return this.animeCatalogService.listAll();
  }

  @Get('search')
  @ApiOperation({ summary: 'Search anime catalog with filters and pagination' })
  search(
    @Query('q') q?: string,

    @Query('year') year?: string,

    @Query('season') season?: string,

    @Query('genreSlug') genreSlug?: string,

    @Query('genreSlugs') genreSlugs?: string,

    @Query('format') format?: string,

    @Query('airingStatus') airingStatus?: string,

    @Query('hardsubLanguage') hardsubLanguage?: string,

    @Query('sortBy') sortBy?: string,

    @Query('limit') limit?: string,

    @Query('offset') offset?: string,
  ) {
    const parsedGenreSlugs = String(genreSlugs ?? '')
      .split(',')
      .map((s) => s.trim().toLowerCase())
      .filter(Boolean);

    const params: AnimeSearchParams = {
      query: q,

      season: season ?? null,

      genreSlug: genreSlug ?? null,

      genreSlugs: parsedGenreSlugs.length > 0 ? parsedGenreSlugs : undefined,

      format: format ?? null,

      airingStatus: airingStatus ?? null,
    };

    const hardsubKey = String(hardsubLanguage ?? '')
      .trim()
      .toLowerCase();
    if (hardsubKey === 'fa' || hardsubKey === 'en') {
      params.hardsubLanguage = hardsubKey;
    }

    const allowedSort = ['created_at', 'popular', 'title', 'score'] as const;
    if (sortBy && allowedSort.includes(sortBy as (typeof allowedSort)[number])) {
      params.sortBy = sortBy as AnimeSearchParams['sortBy'];
    }

    if (year !== undefined && year !== '') {
      const parsed = Number(year);

      params.year = Number.isFinite(parsed) ? parsed : null;
    }

    if (limit !== undefined && limit !== '') {
      const parsed = Number(limit);

      if (Number.isFinite(parsed)) params.limit = parsed;
    }

    if (offset !== undefined && offset !== '') {
      const parsed = Number(offset);

      if (Number.isFinite(parsed)) params.offset = parsed;
    }

    return this.animeCatalogService.search(params);
  }

  @Get('genres')
  @ApiOperation({ summary: 'List all genres' })
  listGenres() {
    return this.animeCatalogService.listGenres();
  }

  @Get('genres/:slug')
  @ApiOperation({ summary: 'Get genre by slug' })
  getGenre(@Param('slug') slug: string) {
    return this.animeCatalogService.getGenreBySlug(slug);
  }

  @Get('favorite-counts')
  @ApiOperation({ summary: 'Favorite counts per anime' })
  listFavoriteCounts() {
    return this.animeCatalogService.listFavoriteCounts();
  }

  @Get('by-ids')
  @ApiOperation({ summary: 'Anime cards by ids (batch, for My List)' })
  listByIds(@Query('ids') ids?: string) {
    const list = String(ids ?? '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
    return this.animeCatalogService.listByIds(list);
  }

  @Get('anilist/batch')
  @ApiOperation({ summary: 'Resolve local anime ids by AniList ids (batch)' })
  resolveAnilistBatch(@Query('ids') ids?: string) {
    const anilistIds = String(ids ?? '')
      .split(',')

      .map((s) => Number(s.trim()))

      .filter((n) => Number.isFinite(n) && n > 0);

    return this.animeCatalogService.resolveAnilistIdsBatch(anilistIds);
  }

  @Get('anilist/:anilistId')
  @ApiOperation({ summary: 'Resolve local anime id by AniList id' })
  getByAnilist(@Param('anilistId') anilistId: string) {
    return this.animeCatalogService.getByAnilistId(Number(anilistId));
  }

  @Get('studios/:slug/anime')
  @ApiOperation({ summary: 'Anime catalog for a studio' })
  listStudioAnime(@Param('slug') slug: string) {
    return this.animeCatalogService.listAnimeByStudioSlug(slug);
  }

  @Get('studios/:slug')
  @ApiOperation({ summary: 'Get studio by slug' })
  getStudio(@Param('slug') slug: string) {
    return this.animeCatalogService.getStudioBySlug(slug);
  }

  @Get('translators/:slug')
  @ApiOperation({ summary: 'Get translator profile by slug' })
  getTranslator(@Param('slug') slug: string) {
    return this.animeCatalogService.getTranslatorBySlug(slug);
  }

  @Get(':id/favorite-count')
  @ApiOperation({ summary: 'Favorite count for one anime' })
  getFavoriteCount(@Param('id') id: string) {
    return this.animeCatalogService.getFavoriteCount(id);
  }

  @Post(':id/view')
  @HttpCode(200)
  @ApiOperation({ summary: 'Increment anime detail view count' })
  recordView(@Param('id') id: string) {
    return this.animeCatalogService.recordView(id);
  }

  @Get(':id/similar')
  @ApiOperation({ summary: 'Similar anime by shared genres' })
  getSimilar(
    @Param('id') id: string,

    @Query('genres') genres?: string,

    @Query('limit') limit?: string,
  ) {
    const genreSlugs = String(genres ?? '')
      .split(',')

      .map((s) => s.trim())

      .filter(Boolean);

    const parsedLimit = limit ? Number(limit) : 12;

    return this.animeCatalogService.getSimilar(
      id,

      genreSlugs,

      Number.isFinite(parsedLimit) ? parsedLimit : 12,
    );
  }

  @Get(':id')
  @ApiOperation({ summary: 'Anime detail with episodes and relations' })
  getById(@Param('id') id: string) {
    return this.animeCatalogService.getById(id);
  }
}
