import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AnimeCardDto } from '../anime-catalog/anime-catalog.service';
import {
  CtaBannerConfig,
  CtaCardConfig,
  CuratedSliderConfig,
  HomeBlock,
} from '../../entities/home-block.entity';
import { AnimeCatalogService } from '../anime-catalog/anime-catalog.service';
import type {
  HomeCustomBlockPublic,
  HomeCustomBlocksResponse,
} from './home.types';

@Injectable()
export class HomeService {
  constructor(
    @InjectRepository(HomeBlock)
    private readonly blockRepo: Repository<HomeBlock>,
    private readonly animeCatalogService: AnimeCatalogService,
  ) {}

  async getCustomBlocks(): Promise<HomeCustomBlocksResponse> {
    const rows = await this.blockRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const animeCardMap = await this.loadAnimeCardsForSliders(rows);
    const blocks: HomeCustomBlockPublic[] = [];

    for (const row of rows) {
      const resolved = this.resolveBlock(row, animeCardMap);
      if (resolved) blocks.push(resolved);
    }

    return { blocks };
  }

  private async loadAnimeCardsForSliders(
    rows: HomeBlock[],
  ): Promise<Map<string, AnimeCardDto>> {
    const animeIds = new Set<string>();

    for (const row of rows) {
      if (row.type !== 'curated_slider') continue;
      const config = row.config as CuratedSliderConfig;
      for (const id of config.anime_ids ?? []) {
        if (id?.trim()) animeIds.add(id.trim());
      }
    }

    if (animeIds.size === 0) return new Map();

    const cards = await this.animeCatalogService.listByIds([...animeIds]);
    return new Map(cards.map((card) => [card.id, card]));
  }

  private resolveBlock(
    row: HomeBlock,
    animeCardMap: Map<string, AnimeCardDto>,
  ): HomeCustomBlockPublic | null {
    if (row.type === 'curated_slider') {
      const config = row.config as CuratedSliderConfig;
      const animeIds = config.anime_ids ?? [];
      if (!row.title?.trim() || animeIds.length === 0) return null;

      const items = animeIds
        .map((id) => animeCardMap.get(id))
        .filter((item): item is AnimeCardDto => item != null);

      if (items.length === 0) return null;

      return {
        type: 'curated_slider',
        id: row.id,
        title: row.title.trim(),
        items,
      };
    }

    if (row.type === 'cta_banner') {
      const config = row.config as CtaBannerConfig;
      const imageUrl = config.image_url?.trim();
      if (!imageUrl) return null;

      return {
        type: 'cta_banner',
        id: row.id,
        title: row.title,
        image_url: imageUrl,
        link_url: config.link_url?.trim() || null,
        open_in_new_tab: config.open_in_new_tab === true,
      };
    }

    if (row.type === 'cta_card') {
      const config = row.config as CtaCardConfig;
      const imageUrl = config.image_url?.trim();
      if (!row.title?.trim() || !imageUrl) return null;

      return {
        type: 'cta_card',
        id: row.id,
        title: row.title.trim(),
        subtitle: row.subtitle,
        description: row.description,
        image_url: imageUrl,
        link_url: config.link_url?.trim() || null,
        button_label: config.button_label?.trim() || null,
        open_in_new_tab: config.open_in_new_tab === true,
      };
    }

    return null;
  }
}
