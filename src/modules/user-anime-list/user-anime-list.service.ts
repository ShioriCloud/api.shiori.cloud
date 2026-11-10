import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { UserAnimeListEntry } from '../../entities';
import {
  ReorderUserAnimeFavoritesDto,
  UpsertUserAnimeListDto,
} from './user-anime-list.dto';

const dateOnly = (value: string | null | undefined): string | null => {
  const raw = value?.trim() ?? '';
  return /^\d{4}-\d{2}-\d{2}/.test(raw) ? raw.slice(0, 10) : null;
};

const assertDateOnly = (value: string | null): string | null => {
  if (value == null) return null;
  const day = dateOnly(value);
  if (!day) throw new BadRequestException('invalid date');
  const [year, month, date] = day.split('-').map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, date));
  if (
    parsed.getUTCFullYear() !== year ||
    parsed.getUTCMonth() !== month - 1 ||
    parsed.getUTCDate() !== date
  ) {
    throw new BadRequestException('invalid date');
  }
  return day;
};

@Injectable()
export class UserAnimeListService {
  constructor(
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
  ) {}

  async list(telegramUserId: string) {
    const rows = await this.listRepo
      .createQueryBuilder('e')
      .where('e.telegram_user_id = :telegramUserId', { telegramUserId })
      .orderBy('e.favorite_rank', 'ASC', 'NULLS LAST')
      .addOrderBy('e.updated_at', 'DESC')
      .getMany();

    return {
      items: rows.map((row) => ({
        anime_id: row.animeId,
        episodes_watched: row.episodesWatched,
        user_rating:
          row.userRating != null && row.userRating !== ''
            ? Number(row.userRating)
            : null,
        is_favorite: row.isFavorite !== false,
        favorite_rank: row.favoriteRank,
        list_status: row.listStatus,
        list_status_at: row.listStatusAt?.toISOString() ?? null,
        started_on: dateOnly(row.startedOn),
        finished_on: dateOnly(row.finishedOn),
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  async upsert(telegramUserId: string, body: UpsertUserAnimeListDto) {
    const animeId = body.anime_id.trim();
    let row = await this.listRepo.findOne({
      where: { telegramUserId, animeId },
    });

    const previousEpisodes = row?.episodesWatched ?? 0;
    const previousUpdatedAt = row?.updatedAt ?? null;

    const episodesWatched =
      body.episodes_watched !== undefined
        ? Math.max(0, Math.floor(body.episodes_watched))
        : previousEpisodes;

    const userRating =
      body.user_rating === undefined
        ? (row?.userRating ?? null)
        : body.user_rating === null
          ? null
          : String(body.user_rating);

    const ratingTouched = body.user_rating !== undefined;

    const isFavorite =
      body.is_favorite !== undefined
        ? body.is_favorite
        : row
          ? row.isFavorite !== false
          : false;

    const listStatusTouched = body.list_status !== undefined;
    const nextListStatus =
      body.list_status !== undefined
        ? body.list_status
        : (row?.listStatus ?? null);
    const listStatusChanged =
      listStatusTouched &&
      String(nextListStatus ?? '') !== String(row?.listStatus ?? '');

    const startedOn =
      body.started_on !== undefined
        ? assertDateOnly(body.started_on)
        : (row?.startedOn ?? null);
    const finishedOn =
      body.finished_on !== undefined
        ? assertDateOnly(body.finished_on)
        : (row?.finishedOn ?? null);

    // Watch history / feed order use updated_at — only bump when episodes change.
    const episodesChanged = episodesWatched !== previousEpisodes;

    if (!row) {
      row = this.listRepo.create({
        telegramUserId,
        animeId,
        episodesWatched,
        userRating,
        isFavorite,
        listStatus: nextListStatus,
        listStatusAt:
          listStatusChanged || (listStatusTouched && nextListStatus)
            ? new Date()
            : null,
        startedOn,
        finishedOn,
        updatedAt: new Date(),
      });
    } else {
      row.episodesWatched = episodesWatched;
      if (body.user_rating !== undefined) row.userRating = userRating;
      if (body.is_favorite !== undefined) row.isFavorite = body.is_favorite;
      if (listStatusTouched) {
        row.listStatus = nextListStatus;
        if (listStatusChanged) row.listStatusAt = new Date();
      }
      if (body.started_on !== undefined) row.startedOn = startedOn;
      if (body.finished_on !== undefined) row.finishedOn = finishedOn;
      row.updatedAt = episodesChanged
        ? new Date()
        : (previousUpdatedAt ?? row.updatedAt);
    }

    if (isFavorite && row.favoriteRank == null) {
      const maxRow = await this.listRepo
        .createQueryBuilder('e')
        .select('MAX(e.favorite_rank)', 'max')
        .where('e.telegram_user_id = :telegramUserId', { telegramUserId })
        .andWhere('e.is_favorite = true')
        .getRawOne<{ max: number | null }>();
      const max = maxRow?.max != null ? Number(maxRow.max) : -1;
      row.favoriteRank = Number.isFinite(max) ? max + 1 : 0;
    }

    if (!isFavorite && body.is_favorite === false) {
      row.favoriteRank = null;
    }

    await this.listRepo.save(row);

    const favoriteCount = await this.listRepo.count({
      where: { animeId, isFavorite: true },
    });
    const shioriScore = ratingTouched
      ? await this.refreshShioriScore(animeId)
      : undefined;

    return {
      ok: true as const,
      favorite_count: favoriteCount,
      ...(shioriScore !== undefined ? { shiori_score: shioriScore } : {}),
    };
  }

  async reorderFavorites(
    telegramUserId: string,
    body: ReorderUserAnimeFavoritesDto,
  ) {
    const ids = body.anime_ids.map((id) => id.trim()).filter(Boolean);
    if (ids.length === 0) {
      return { ok: true as const };
    }

    const rows = await this.listRepo.find({
      where: {
        telegramUserId,
        animeId: In(ids),
        isFavorite: true,
      },
    });
    const rowByAnime = new Map(rows.map((r) => [r.animeId, r]));

    for (let i = 0; i < ids.length; i++) {
      const row = rowByAnime.get(ids[i]);
      if (!row) continue;
      // Update only rank — avoid save() side-effects on updated_at / watch order.
      await this.listRepo
        .createQueryBuilder()
        .update(UserAnimeListEntry)
        .set({ favoriteRank: i })
        .where('id = :id', { id: row.id })
        .execute();
    }

    return { ok: true as const };
  }

  async remove(telegramUserId: string, animeId: string) {
    const result = await this.listRepo.delete({ telegramUserId, animeId });
    if (!result.affected) {
      throw new NotFoundException('List entry not found');
    }
    const favoriteCount = await this.listRepo.count({
      where: { animeId, isFavorite: true },
    });
    const shioriScore = await this.refreshShioriScore(animeId);
    return {
      ok: true as const,
      favorite_count: favoriteCount,
      shiori_score: shioriScore,
    };
  }

  /** Recompute cached average; returns the new score (or null when none). */
  private async refreshShioriScore(animeId: string): Promise<number | null> {
    const raw = await this.listRepo.manager.query(
      `
      SELECT ROUND(AVG(user_rating)::numeric, 1) AS avg
      FROM user_anime_list
      WHERE anime_id = $1
        AND user_rating IS NOT NULL
      `,
      [animeId],
    );

    const avgRaw = Array.isArray(raw) ? raw[0]?.avg : null;
    const avg =
      avgRaw != null && avgRaw !== '' && Number.isFinite(Number(avgRaw))
        ? Number(avgRaw)
        : null;

    await this.listRepo.manager.query(
      `
      UPDATE anime
      SET shiori_score = $2
      WHERE id = $1
      `,
      [animeId, avg],
    );

    return avg;
  }
}
