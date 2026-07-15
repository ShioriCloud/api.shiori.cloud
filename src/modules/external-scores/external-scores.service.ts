import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  fetchExternalScoresDetailed,
  normalizeExternalId,
  resolveExternalScoreIds,
} from '../../common/external-score.util';
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
  error?: string | null;
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

  async fetchExternalScores(ids: ExternalScoreIds): Promise<ExternalScores> {
    const result = await fetchExternalScoresDetailed(ids);
    return {
      anilistScore: result.anilistScore,
      malScore: result.malScore,
    };
  }

  private hasExternalIds(ids: ExternalScoreIds): boolean {
    const resolved = resolveExternalScoreIds(ids);
    return resolved.anilist_id != null || resolved.mal_id != null;
  }

  private scoreToDb(value: number | null): string | null {
    return value != null && Number.isFinite(value) ? String(value) : null;
  }

  private applyExternalIds(anime: Anime, overrideIds?: ExternalScoreIds): void {
    if (overrideIds?.anilist_id !== undefined) {
      anime.anilistId = normalizeExternalId(overrideIds.anilist_id);
    }
    if (overrideIds?.mal_id !== undefined) {
      anime.malId = normalizeExternalId(overrideIds.mal_id);
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
    errors: Array<{ source: 'anilist' | 'mal'; message: string }>,
  ): SyncExternalScoresResult {
    const resolved = resolveExternalScoreIds(ids);
    const errorFor = (source: 'anilist' | 'mal') =>
      errors.find((entry) => entry.source === source)?.message ?? null;

    return {
      ...scores,
      sources: {
        anilist: {
          requested: resolved.anilist_id != null,
          ok: scores.anilistScore != null,
          error: resolved.anilist_id != null && scores.anilistScore == null ? errorFor('anilist') : null,
        },
        mal: {
          requested: resolved.mal_id != null,
          ok: scores.malScore != null,
          error: resolved.mal_id != null && scores.malScore == null ? errorFor('mal') : null,
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

    const fetched = await fetchExternalScoresDetailed(ids);
    const scores = {
      anilistScore: fetched.anilistScore,
      malScore: fetched.malScore,
    };

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
    return this.buildSyncResult(ids, scores, fetched.errors);
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
        const fetched = await fetchExternalScoresDetailed({
          anilist_id: row.anilistId,
          mal_id: row.malId,
        });
        await this.applyScoresToAnime(row.id, {
          anilistScore: fetched.anilistScore,
          malScore: fetched.malScore,
        });
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
