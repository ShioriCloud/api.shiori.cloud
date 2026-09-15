import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { AnimeCardDto } from '../anime-catalog/anime-catalog.service';
import {
  CtaBannerConfig,
  CtaCardConfig,
  CuratedSliderConfig,
  HomeBlock,
  SystemRailConfig,
} from '../../entities/home-block.entity';
import { AnimeCatalogService } from '../anime-catalog/anime-catalog.service';
import {
  isSystemRailId,
  SYSTEM_RAIL_LABELS,
} from '../home-admin/home-block.util';
import type {
  HomeCustomBlockPublic,
  HomeCustomBlocksResponse,
} from './home.types';

const animeDetailPath = (anime: Pick<AnimeCardDto, 'id' | 'slug'>) => {
  const slug = String(anime.slug ?? '').trim();
  const segment = slug || String(anime.id);
  return `/anime/${encodeURIComponent(segment)}`;
};

/** Prefer internal `/anime/...` paths so the mini-app stays in-router. */
const resolveCtaLinkUrl = (
  configLink: string | null | undefined,
  anime: Pick<AnimeCardDto, 'id' | 'slug'>,
): string => {
  const raw = String(configLink ?? '').trim();
  if (!raw) return animeDetailPath(anime);

  if (raw.startsWith('/anime/')) return raw;

  try {
    if (/^https?:\/\//i.test(raw)) {
      const url = new URL(raw);
      if (url.pathname.startsWith('/anime/')) {
        return `${url.pathname}${url.search}${url.hash}`;
      }
    }
  } catch {
    // fall through
  }

  return raw;
};

@Injectable()
export class HomeService {
  constructor(
    @InjectRepository(HomeBlock)
    private readonly blockRepo: Repository<HomeBlock>,
    private readonly animeCatalogService: AnimeCatalogService,
  ) {}

  async getCustomBlocks(): Promise<HomeCustomBlocksResponse> {
    const systemRailCount = await this.blockRepo.count({
      where: { type: 'system_rail' },
    });
    const layout_mode = systemRailCount > 0 ? 'unified' : 'legacy';

    const rows = await this.blockRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });

    const animeCardMap = await this.loadAnimeCardsForBlocks(rows);
    const blocks: HomeCustomBlockPublic[] = [];

    for (const row of rows) {
      const resolved = this.resolveBlock(row, animeCardMap);
      if (resolved) blocks.push(resolved);
    }

    return { blocks, layout_mode };
  }

  private async loadAnimeCardsForBlocks(
    rows: HomeBlock[],
  ): Promise<Map<string, AnimeCardDto>> {
    const animeIds = new Set<string>();

    for (const row of rows) {
      if (row.type === 'curated_slider') {
        const config = row.config as CuratedSliderConfig;
        for (const id of config.anime_ids ?? []) {
          if (id?.trim()) animeIds.add(id.trim());
        }
        continue;
      }

      if (row.type === 'cta_card') {
        const config = row.config as CtaCardConfig;
        const id = config.anime_id?.trim();
        if (id) animeIds.add(id);
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
      const animeId = config.anime_id?.trim() || null;
      const anime = animeId ? animeCardMap.get(animeId) : undefined;

      if (!anime) return null;

      // Prefer live anime art so title/synopsis and poster stay in sync.
      // config.image_url is only a fallback when the anime has no cover yet.
      const imageUrl =
        anime.featuredImage?.trim() ||
        anime.image?.trim() ||
        config.image_url?.trim() ||
        '';
      if (!imageUrl) return null;

      const linkUrl = resolveCtaLinkUrl(config.link_url, anime);
      const description =
        anime.description?.trim() || row.description?.trim() || null;

      return {
        type: 'cta_card',
        id: row.id,
        anime_id: anime.id,
        slug: anime.slug ?? null,
        title: anime.title,
        description,
        image_url: imageUrl,
        link_url: linkUrl,
        button_label: config.button_label?.trim() || null,
        open_in_new_tab: config.open_in_new_tab === true,
        hardsub_language: anime.hardsub_language,
        video_file_type: anime.video_file_type,
        video_resolution: anime.video_resolution,
        video_encode: anime.video_encode,
      };
    }

    if (row.type === 'system_rail') {
      const config = row.config as SystemRailConfig;
      const railId = config.rail_id?.trim() ?? '';
      if (!isSystemRailId(railId)) return null;
      return {
        type: 'system_rail',
        id: row.id,
        rail_id: railId,
        title: row.title?.trim() || SYSTEM_RAIL_LABELS[railId],
      };
    }

    return null;
  }
}
