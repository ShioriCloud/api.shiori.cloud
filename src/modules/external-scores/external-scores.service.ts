import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { findAnimeByIdOrSlug } from '../../common/anime-ref.util';
import { Anime } from '../../entities';

export type ExternalScoreIds = {
  anilist_id?: number | null;
  mal_id?: number | null;
};

export type ExternalScores = {
  anilistScore: number | null;
  malScore: number | null;
};

export type ExternalScoreSourceStatus = {
  requested: boolean;
  ok: boolean;
};

export type SyncExternalScoresResult = ExternalScores & {
  sources: {
    anilist: ExternalScoreSourceStatus;
    mal: ExternalScoreSourceStatus;
  };
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class ExternalScoresService {
  constructor(
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
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

  async fetchExternalScores(ids: ExternalScoreIds): Promise<ExternalScores> {
    const anilistId =
      typeof ids.anilist_id === 'number' && ids.anilist_id > 0
        ? ids.anilist_id
        : null;
    const malId =
      typeof ids.mal_id === 'number' && ids.mal_id > 0 ? ids.mal_id : null;

    const [anilistResult, malResult] = await Promise.allSettled([
      anilistId ? this.fetchAnilistScorePercent(anilistId) : Promise.resolve(null),
      malId ? this.fetchMalScore(malId) : Promise.resolve(null),
    ]);

    const unwrap = (r: PromiseSettledResult<number | null>): number | null =>
      r.status === 'fulfilled' ? r.value : null;

    return {
      anilistScore: unwrap(anilistResult),
      malScore: unwrap(malResult),
    };
  }

  private hasExternalIds(ids: ExternalScoreIds): boolean {
    return Boolean(
      (typeof ids.anilist_id === 'number' && ids.anilist_id > 0) ||
        (typeof ids.mal_id === 'number' && ids.mal_id > 0),
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
    anime.updatedAt = new Date();

    await this.animeRepo.save(anime);
    return scores;
  }

  private buildSyncResult(
    ids: ExternalScoreIds,
    scores: ExternalScores,
  ): SyncExternalScoresResult {
    return {
      ...scores,
      sources: {
        anilist: {
          requested: typeof ids.anilist_id === 'number' && ids.anilist_id > 0,
          ok: scores.anilistScore != null,
        },
        mal: {
          requested: typeof ids.mal_id === 'number' && ids.mal_id > 0,
          ok: scores.malScore != null,
        },
      },
    };
  }

  async syncAnimeById(
    animeIdOrSlug: string,
    overrideIds?: ExternalScoreIds,
  ): Promise<SyncExternalScoresResult> {
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
    };

    if (!this.hasExternalIds(ids)) {
      throw new BadRequestException('شناسه AniList / MAL ثبت نشده');
    }

    const scores = await this.fetchExternalScores(ids);

    const hasOverrideFields = Boolean(
      overrideIds &&
        (overrideIds.anilist_id !== undefined || overrideIds.mal_id !== undefined),
    );

    if (hasOverrideFields) {
      this.applyExternalIds(anime, overrideIds);
      anime.updatedAt = new Date();
      await this.animeRepo.save(anime);
    }

    await this.applyScoresToAnime(animeId, scores);
    return this.buildSyncResult(ids, scores);
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
      .select(['a.id', 'a.anilistId', 'a.malId'])
      .where('(a.anilistId IS NOT NULL OR a.malId IS NOT NULL)')
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
