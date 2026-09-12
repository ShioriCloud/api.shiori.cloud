import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, Repository } from 'typeorm';
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

  private scoreEqualsDb(stored: string | null, next: number | null): boolean {
    if (next == null) return true;
    const current = Number(stored);
    return Number.isFinite(current) && current === next;
  }

  async applyScoresToAnime(
    animeId: string,
    scores: ExternalScores,
  ): Promise<{ scores: ExternalScores; changed: boolean }> {
    const anime = await this.animeRepo.findOne({ where: { id: animeId } });
    if (!anime) throw new NotFoundException('anime not found');

    let changed = false;
    if (scores.anilistScore != null && !this.scoreEqualsDb(anime.averageScore, scores.anilistScore)) {
      anime.averageScore = this.scoreToDb(scores.anilistScore);
      changed = true;
    }
    if (scores.malScore != null && !this.scoreEqualsDb(anime.malScore, scores.malScore)) {
      anime.malScore = this.scoreToDb(scores.malScore);
      changed = true;
    }

    if (changed) {
      anime.updatedAt = new Date();
      await this.animeRepo.save(anime);
    }
    return { scores, changed };
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
    missingOnly?: boolean;
    afterId?: string;
  }) {
    const limit = Math.min(Math.max(options?.limit ?? 25, 1), 100);
    const offset = Math.max(options?.offset ?? 0, 0);
    const delayMs = Math.min(Math.max(options?.delayMs ?? 700, 0), 2000);
    const missingOnly = options?.missingOnly !== false;
    const afterId = options?.afterId?.trim() || null;

    const query = this.animeRepo
      .createQueryBuilder('a')
      .select(['a.id', 'a.anilistId', 'a.malId'])
      .where('(a.anilistId IS NOT NULL OR a.malId IS NOT NULL)');

    if (missingOnly) {
      query.andWhere(
        new Brackets((qb) => {
          qb.where('a.anilistId IS NOT NULL AND a.averageScore IS NULL').orWhere(
            'a.malId IS NOT NULL AND a.malScore IS NULL',
          );
        }),
      );
      if (afterId) {
        query.andWhere('a.id > :afterId', { afterId });
      }
    } else {
      query.skip(offset);
    }

    const rows = await query.orderBy('a.id', 'ASC').take(limit).getMany();

    let updated = 0;
    const errors: Array<{ id: string; message: string }> = [];

    for (const row of rows) {
      try {
        const fetched = await fetchExternalScoresDetailed({
          anilist_id: row.anilistId,
          mal_id: row.malId,
        });
        const applied = await this.applyScoresToAnime(row.id, {
          anilistScore: fetched.anilistScore,
          malScore: fetched.malScore,
        });
        if (applied.changed) updated += 1;
      } catch (e) {
        errors.push({
          id: row.id,
          message: e instanceof Error ? e.message : 'Unknown error',
        });
      }

      if (delayMs > 0) await sleep(delayMs);
    }

    const hasMore = rows.length === limit;
    const lastId = rows.at(-1)?.id ?? null;
    return {
      processed: rows.length,
      updated,
      offset,
      nextOffset: missingOnly ? null : hasMore ? offset + limit : null,
      afterId,
      nextAfterId: missingOnly && hasMore ? lastId : null,
      hasMore,
      errors,
    };
  }
}
