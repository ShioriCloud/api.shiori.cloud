import { BadRequestException } from '@nestjs/common';
import { normalizeSlug } from '../../common/slug.util';

const MEDIA_BASE_NAME_MAX = 120;

export function sanitizeMediaBaseName(value: string): string {
  const normalized = normalizeSlug(value);
  if (!normalized || normalized.length > MEDIA_BASE_NAME_MAX) {
    throw new BadRequestException('invalid image name');
  }
  return normalized;
}
