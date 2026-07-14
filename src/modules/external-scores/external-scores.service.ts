import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { findAnimeByIdOrSlug } from '../../common/anime-ref.util';
import { Anime } from '../../entities';

export type ExternalScoreIds = {
  anilist_id?: number | null;
  mal_id?: number | null;
  imdb_id?: string | null;
};

export type ExternalScores = {
  anilistScore: number | null;
  malScore: number | null;
  imdbScore: number | null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ExternalScoresService {
  constructor(
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    private readonly config: ConfigService,
  ) {}

  private async fetchAnilistScorePercent(anilistId: number): Promise<number | null> {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        query: `
          query ($id: Int) {
            Media(id: $id, type: ANIME) {
              meanScore
              averageScore
            }
          }
        `,
        variables: { id: anilistId },
      }),
    });

    if (!res.ok) return null;

    const json = (await res.json()) as {
      data?: { Media?: { meanScore?: number | null; averageScore?: number | null } };
    };

    const media = json.data?.Media;
    if (!media) return null;

    if (typeof media.averageScore === 'number' && media.averageScore > 0) {
      return media.averageScore;
    }
    if (typeof media.meanScore === 'number' && media.meanScore > 0) {
      return media.meanScore;
    }

    return null;
  }

  private async fetchMalScore(malId: number): Promise<number | null> {
    const res = await fetch(`https://api.jikan.moe/v4/anime/${malId}`);
    if (!res.ok) return null;

    const json = (await res.json()) as { data?: { score?: number | null } };
    const score = json.data?.score;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  private async fetchOmdbScore(imdbId: string, apiKey: string): Promise<number | null> {
    const url = new URL('https://www.omdbapi.com/');
    url.searchParams.set('apikey', apiKey.trim());
    url.searchParams.set('i', imdbId.trim());

    const res = await fetch(url.toString());
    if (!res.ok) return null;

    const json = (await res.json()) as { imdbRating?: string };
    if (!json.imdbRating || json.imdbRating === 'N/A') return null;

    const score = Number(json.imdbRating);
    return Number.isFinite(score) ? score : null;
  }

  private async fetchImdbApiDevScore(imdbId: string): Promise<number | null> {
    const res = await fetch(
      `https://api.imdbapi.dev/titles/${encodeURIComponent(imdbId.trim())}`,
    );
    if (!res.ok) return null;

    const json = (await res.json()) as {
      rating?: { aggregateRating?: number | null };
    };
    const score = json.rating?.aggregateRating;
    return typeof score === 'number' && Number.isFinite(score) ? score : null;
  }

  private async fetchImdbScore(imdbId: string): Promise<number | null> {
    const cleanId = imdbId.trim();
    if (!cleanId) return null;

    const omdbApiKey = this.config.get<string>('externalScores.omdbApiKey')?.trim();
    if (omdbApiKey) {
      const fromOmdb = await this.fetchOmdbScore(cleanId, omdbApiKey);
      if (fromOmdb !== null) return fromOmdb;
    }

    return this.fetchImdbApiDevScore(cleanId);
  }

  async fetchExternalScores(ids: ExternalScoreIds): Promise<ExternalScores> {
    const anilistId =
      typeof ids.anilist_id === 'number' && ids.anilist_id > 0
        ? ids.anilist_id
        : null;
    const malId =
      typeof ids.mal_id === 'number' && ids.mal_id > 0 ? ids.mal_id : null;
    const imdbId =
      typeof ids.imdb_id === 'string' && ids.imdb_id.trim()
        ? ids.imdb_id.trim()
        : null;

    const [anilistResult, malResult, imdbResult] = await Promise.allSettled([
      anilistId ? this.fetchAnilistScorePercent(anilistId) : Promise.resolve(null),
      malId ? this.fetchMalScore(malId) : Promise.resolve(null),
      imdbId ? this.fetchImdbScore(imdbId) : Promise.resolve(null),
    ]);

    const unwrap = (r: PromiseSettledResult<number | null>): number | null =>
      r.status === 'fulfilled' ? r.value : null;

    return {
      anilistScore: unwrap(anilistResult),
      malScore: unwrap(malResult),
      imdbScore: unwrap(imdbResult),
    };
  }

  private hasExternalIds(ids: ExternalScoreIds): boolean {
    return Boolean(
      (typeof ids.anilist_id === 'number' && ids.anilist_id > 0) ||
        (typeof ids.mal_id === 'number' && ids.mal_id > 0) ||
        (typeof ids.imdb_id === 'string' && ids.imdb_id.trim()),
    );
  }

  private scoreToDb(value: number | null): string | null {
    return value != null && Number.isFinite(value) ? String(value) : null;
  }

  private applyExternalIds(anime: Anime, overrideIds?: ExternalScoreIds): void {
    if (overrideIds?.anilist_id !== undefined) {
      anime.anilistId =
        typeof overrideIds.anilist_id === 'number' && overrideIds.anilist_id > 0
          ? overrideIds.anilist_id
          : null;
    }
    if (overrideIds?.mal_id !== undefined) {
      anime.malId =
        typeof overrideIds.mal_id === 'number' && overrideIds.mal_id > 0
          ? overrideIds.mal_id
          : null;
    }
    if (overrideIds?.imdb_id !== undefined) {
      const imdbId =
        typeof overrideIds.imdb_id === 'string' ? overrideIds.imdb_id.trim() : '';
      anime.imdbId = imdbId || null;
    }
  }

  async applyScoresToAnime(animeId: string, scores: ExternalScores): Promise<ExternalScores> {
    const anime = await this.animeRepo.findOne({ where: { id: animeId } });
    if (!anime) throw new NotFoundException('anime not found');

    if (scores.anilistScore != null) {
      anime.averageScore = this.scoreToDb(scores.anilistScore);
    }
    if (scores.malScore != null) {
      anime.malScore = this.scoreToDb(scores.malScore);
    }
    if (scores.imdbScore != null) {
      anime.imdbScore = this.scoreToDb(scores.imdbScore);
    }
    anime.updatedAt = new Date();

    await this.animeRepo.save(anime);
    return scores;
  }

  async syncAnimeById(
    animeIdOrSlug: string,
    overrideIds?: ExternalScoreIds,
  ): Promise<ExternalScores> {
    const anime = await findAnimeByIdOrSlug(this.animeRepo, animeIdOrSlug);
    if (!anime) throw new NotFoundException('anime not found');

    const animeId = anime.id;

    const ids: ExternalScoreIds = {
      anilist_id:
        overrideIds?.anilist_id !== undefined
          ? overrideIds.anilist_id
          : anime.anilistId,
      mal_id:
        overrideIds?.mal_id !== undefined ? overrideIds.mal_id : anime.malId,
      imdb_id:
        overrideIds?.imdb_id !== undefined ? overrideIds.imdb_id : anime.imdbId,
    };

    if (!this.hasExternalIds(ids)) {
      throw new BadRequestException('شناسه AniList / MAL / IMDb ثبت نشده');
    }

    const scores = await this.fetchExternalScores(ids);

    const hasOverrideFields = Boolean(
      overrideIds &&
        (overrideIds.anilist_id !== undefined ||
          overrideIds.mal_id !== undefined ||
          overrideIds.imdb_id !== undefined),
    );

    if (hasOverrideFields) {
      this.applyExternalIds(anime, overrideIds);
      anime.updatedAt = new Date();
      await this.animeRepo.save(anime);
    }

    await this.applyScoresToAnime(animeId, scores);
    return scores;
  }

  async syncBatch(options?: {
    limit?: number;
    offset?: number;
    delayMs?: number;
  }) {
    const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);
    const delayMs = Math.min(Math.max(options?.delayMs ?? 400, 0), 2000);

    const rows = await this.animeRepo
      .createQueryBuilder('a')
      .select(['a.id', 'a.anilistId', 'a.malId', 'a.imdbId'])
      .where(
        '(a.anilistId IS NOT NULL OR a.malId IS NOT NULL OR (a.imdbId IS NOT NULL AND a.imdbId <> \'\'))',
      )
      .orderBy('a.id', 'ASC')
      .skip(offset)
      .take(limit)
      .getMany();

    let updated = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const row of rows) {
      try {
        const scores = await this.fetchExternalScores({
          anilist_id: row.anilistId,
          mal_id: row.malId,
          imdb_id: row.imdbId,
        });
        await this.applyScoresToAnime(row.id, scores);
        updated += 1;
      } catch (e) {
        errors.push({
          id: row.id,
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    const hasMore = rows.length === limit;
    return {
      processed: rows.length,
      updated,
      offset,
      nextOffset: hasMore ? offset + limit : null,
      hasMore,
      errors,
    };
  }
}
