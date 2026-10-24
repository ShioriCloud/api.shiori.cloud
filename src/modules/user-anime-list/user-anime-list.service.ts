import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserAnimeListEntry } from '../../entities';
import { UpsertUserAnimeListDto } from './user-anime-list.dto';

@Injectable()
export class UserAnimeListService {
  constructor(
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
  ) {}

  async list(telegramUserId: string) {
    const rows = await this.listRepo.find({
      where: { telegramUserId },
      order: { updatedAt: 'DESC' },
    });

    return {
      items: rows.map((row) => ({
        anime_id: row.animeId,
        episodes_watched: row.episodesWatched,
        user_rating:
          row.userRating != null && row.userRating !== ''
            ? Number(row.userRating)
            : null,
        is_favorite: row.isFavorite !== false,
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  async upsert(telegramUserId: string, body: UpsertUserAnimeListDto) {
    const animeId = body.anime_id.trim();
    let row = await this.listRepo.findOne({
      where: { telegramUserId, animeId },
    });

    const episodesWatched =
      body.episodes_watched !== undefined
        ? Math.max(0, Math.floor(body.episodes_watched))
        : (row?.episodesWatched ?? 0);

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

    if (!row) {
      row = this.listRepo.create({
        telegramUserId,
        animeId,
        episodesWatched,
        userRating,
        isFavorite,
      });
    } else {
      row.episodesWatched = episodesWatched;
      if (body.user_rating !== undefined) row.userRating = userRating;
      if (body.is_favorite !== undefined) row.isFavorite = body.is_favorite;
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
