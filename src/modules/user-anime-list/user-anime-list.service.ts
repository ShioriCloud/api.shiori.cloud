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

    if (!row) {
      row = this.listRepo.create({
        telegramUserId,
        animeId,
        episodesWatched,
        userRating,
      });
    } else {
      row.episodesWatched = episodesWatched;
      if (body.user_rating !== undefined) row.userRating = userRating;
    }

    await this.listRepo.save(row);
    return { ok: true };
  }

  async remove(telegramUserId: string, animeId: string) {
    const result = await this.listRepo.delete({ telegramUserId, animeId });
    if (!result.affected) {
      throw new NotFoundException('List entry not found');
    }
    return { ok: true };
  }
}
