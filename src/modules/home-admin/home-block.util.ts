import { BadRequestException } from '@nestjs/common';
import type {
  CtaBannerConfig,
  CtaCardConfig,
  CuratedSliderConfig,
  HomeBlock,
  HomeBlockType,
} from '../../entities/home-block.entity';

export const MAX_CURATED_ANIME_IDS = 100;

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export const isValidUuid = (value: string): boolean => UUID_V4.test(value);

export const normalizeConfig = (
  type: HomeBlockType,
  raw?: Record<string, unknown>,
): HomeBlock['config'] => {
  const config = raw ?? {};

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
  if (!title?.trim()) {
    throw new BadRequestException('کارت CTA به عنوان نیاز دارد');
  }
  if (!card.image_url?.trim() || !isAllowedImageUrl(card.image_url)) {
    throw new BadRequestException('کارت CTA به تصویر معتبر نیاز دارد');
  }
  if (card.link_url && !isAllowedLinkUrl(card.link_url)) {
    throw new BadRequestException('لینک کارت نامعتبر است');
  }
};
