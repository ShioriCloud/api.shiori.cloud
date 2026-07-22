import type { AnimeCardDto } from '../anime-catalog/anime-catalog.service';
import type { HomeBlockType } from '../../entities/home-block.entity';

export type HomeCuratedSliderBlock = {
  type: 'curated_slider';
  id: string;
  title: string;
  items: AnimeCardDto[];
};

export type HomeCtaBannerBlock = {
  type: 'cta_banner';
  id: string;
  title: string | null;
  image_url: string;
  link_url: string | null;
  open_in_new_tab: boolean;
};

export type HomeCtaCardBlock = {
  type: 'cta_card';
  id: string;
  title: string;
  subtitle: string | null;
  description: string | null;
  image_url: string;
  link_url: string | null;
  button_label: string | null;
  open_in_new_tab: boolean;
};

export type HomeCustomBlockPublic =
  | HomeCuratedSliderBlock
  | HomeCtaBannerBlock
  | HomeCtaCardBlock;

export type HomeCustomBlocksResponse = {
  blocks: HomeCustomBlockPublic[];
};

export type { HomeBlockType };
