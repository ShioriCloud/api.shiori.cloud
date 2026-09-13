import { BadRequestException } from '@nestjs/common';
import type {
  CtaBannerConfig,
  CtaCardConfig,
  CuratedSliderConfig,
  HomeBlock,
  HomeBlockType,
  HomeSystemRailId,
  SystemRailConfig,
} from '../../entities/home-block.entity';

export const MAX_CURATED_ANIME_IDS = 100;

export const SYSTEM_RAIL_IDS = [
  'recent',
  'latest',
  'popular',
  'donghua',
  'movies',
] as const satisfies readonly HomeSystemRailId[];

export const SYSTEM_RAIL_LABELS: Record<HomeSystemRailId, string> = {
  recent: 'تازه‌اضافه‌شده',
  latest: 'فصل جاری',
  popular: 'محبوب‌ترین‌ها',
  donghua: 'دونگهوا',
  movies: 'انیمه سینمایی',
};

export const SYSTEM_RAIL_SEED: Array<{
  id: string;
  rail_id: HomeSystemRailId;
  sort_order: number;
}> = [
  {
    id: 'a1111111-1111-4111-8111-111111111101',
    rail_id: 'recent',
    sort_order: 1,
  },
  {
    id: 'a1111111-1111-4111-8111-111111111102',
    rail_id: 'latest',
    sort_order: 2,
  },
  {
    id: 'a1111111-1111-4111-8111-111111111103',
    rail_id: 'popular',
    sort_order: 3,
  },
  {
    id: 'a1111111-1111-4111-8111-111111111104',
    rail_id: 'donghua',
    sort_order: 4,
  },
  {
    id: 'a1111111-1111-4111-8111-111111111105',
    rail_id: 'movies',
    sort_order: 5,
  },
];

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value: string): boolean => UUID_V4.test(value);

export const isSystemRailId = (value: string): value is HomeSystemRailId =>
  (SYSTEM_RAIL_IDS as readonly string[]).includes(value);

export const normalizeConfig = (
  type: HomeBlockType,
  raw?: Record<string, unknown>,
): HomeBlock['config'] => {
  const config = raw ?? {};

  if (type === 'system_rail') {
    const railId =
      typeof config.rail_id === 'string' ? config.rail_id.trim() : '';
    return {
      rail_id: isSystemRailId(railId) ? railId : undefined,
    } satisfies SystemRailConfig;
  }

  if (type === 'curated_slider') {
    const animeIds = Array.isArray(config.anime_ids)
      ? config.anime_ids.map((id) => String(id).trim()).filter(Boolean)
      : [];
    return {
      anime_ids: [...new Set(animeIds)].slice(0, MAX_CURATED_ANIME_IDS),
    } satisfies CuratedSliderConfig;
  }

  if (type === 'cta_banner') {
    return {
      image_url:
        typeof config.image_url === 'string' ? config.image_url.trim() : '',
      link_url:
        typeof config.link_url === 'string' ? config.link_url.trim() : '',
      open_in_new_tab: config.open_in_new_tab === true,
    } satisfies CtaBannerConfig;
  }

  return {
    anime_id:
      typeof config.anime_id === 'string' ? config.anime_id.trim() : '',
    image_url:
      typeof config.image_url === 'string' ? config.image_url.trim() : '',
    link_url:
      typeof config.link_url === 'string' ? config.link_url.trim() : '',
    button_label:
      typeof config.button_label === 'string'
        ? config.button_label.trim()
        : '',
    open_in_new_tab: config.open_in_new_tab === true,
  } satisfies CtaCardConfig;
};

const isAllowedImageUrl = (url: string): boolean => {
  if (!url) return false;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('/api/v1/media/serve/')) return true;
  return false;
};

const isAllowedLinkUrl = (url: string): boolean => {
  if (!url) return true;
  if (/^https?:\/\//i.test(url)) return true;
  if (url.startsWith('/') && !url.startsWith('//')) return true;
  return false;
};

export const validateBlockPayload = (
  type: HomeBlockType,
  title: string | null | undefined,
  config: Record<string, unknown> | HomeBlock['config'] | undefined,
): void => {
  const normalized = normalizeConfig(type, config as Record<string, unknown>);

  if (type === 'system_rail') {
    const railId = (normalized as SystemRailConfig).rail_id;
    if (!railId || !isSystemRailId(railId)) {
      throw new BadRequestException('ریل سیستم نامعتبر است');
    }
    void title;
    return;
  }

  if (type === 'curated_slider') {
    if (!title?.trim()) {
      throw new BadRequestException('اسلایدر دستی به عنوان نیاز دارد');
    }
    const ids = (normalized as CuratedSliderConfig).anime_ids ?? [];
    if (ids.length === 0) {
      throw new BadRequestException('اسلایدر دستی حداقل به یک انیمه نیاز دارد');
    }
    if (ids.length > MAX_CURATED_ANIME_IDS) {
      throw new BadRequestException(
        `حداکثر ${MAX_CURATED_ANIME_IDS} انیمه در هر اسلایدر مجاز است`,
      );
    }
    const invalid = ids.filter((id) => !isValidUuid(id));
    if (invalid.length > 0) {
      throw new BadRequestException('شناسه انیمه نامعتبر است');
    }
    return;
  }

  if (type === 'cta_banner') {
    const banner = normalized as CtaBannerConfig;
    const imageUrl = banner.image_url?.trim();
    if (!imageUrl || !isAllowedImageUrl(imageUrl)) {
      throw new BadRequestException('بنر CTA به تصویر معتبر نیاز دارد');
    }
    if (banner.link_url && !isAllowedLinkUrl(banner.link_url)) {
      throw new BadRequestException('لینک بنر نامعتبر است');
    }
    return;
  }

  const card = normalized as CtaCardConfig;
  const animeId = card.anime_id?.trim();
  if (!animeId || !isValidUuid(animeId)) {
    throw new BadRequestException('کارت CTA به انتخاب انیمه نیاز دارد');
  }
  if (card.image_url?.trim() && !isAllowedImageUrl(card.image_url)) {
    throw new BadRequestException('تصویر کارت نامعتبر است');
  }
  if (card.link_url && !isAllowedLinkUrl(card.link_url)) {
    throw new BadRequestException('لینک کارت نامعتبر است');
  }
  void title;
};
