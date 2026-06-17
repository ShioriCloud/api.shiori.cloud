import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { AnimeCatalogService } from './anime-catalog.service';

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
  @ApiOperation({ summary: 'Popular anime by favorite count' })
  listPopular(@Query('limit') limit?: number) {
    return this.animeCatalogService.listPopular(limit ? Number(limit) : 20);
  }

  @Get('recent')
  @ApiOperation({ summary: 'Recently added anime' })
  listRecent(@Query('limit') limit?: number) {
    return this.animeCatalogService.listRecent(limit ? Number(limit) : 20);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search anime catalog' })
  search(@Query('q') q: string, @Query('limit') limit?: number) {
    return this.animeCatalogService.search(q ?? '', limit ? Number(limit) : 30);
  }

  @Get('genres')
  @ApiOperation({ summary: 'List all genres' })
  listGenres() {
    return this.animeCatalogService.listGenres();
  }

  @Get('anilist/:anilistId')
  @ApiOperation({ summary: 'Resolve local anime id by AniList id' })
  getByAnilist(@Param('anilistId') anilistId: string) {
    return this.animeCatalogService.getByAnilistId(Number(anilistId));
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

  @Get(':id')
  @ApiOperation({ summary: 'Anime detail with episodes and relations' })
  getById(@Param('id') id: string) {
    return this.animeCatalogService.getById(id);
  }
}
