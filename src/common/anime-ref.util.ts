import { NotFoundException } from '@nestjs/common';
import { Repository } from 'typeorm';
import { Anime } from '../entities';
import { isUuid } from './uuid.util';
import { normalizeSlug } from './slug.util';

export async function findAnimeByIdOrSlug(
  repo: Repository<Anime>,
  idOrSlug: string,
): Promise<Anime | null> {
  const raw = String(idOrSlug ?? '').trim();
  if (!raw) return null;

  if (isUuid(raw)) {
    return repo.findOne({ where: { id: raw } });
  }

  const slug = normalizeSlug(raw);
  if (slug) {
    return repo.findOne({ where: { slug } });
  }

  return null;
}

export async function requireAnimeId(
  repo: Repository<Anime>,
  idOrSlug: string,
): Promise<string> {
  const anime = await findAnimeByIdOrSlug(repo, idOrSlug);
  if (!anime) throw new NotFoundException('Anime not found');
  return anime.id;
}
