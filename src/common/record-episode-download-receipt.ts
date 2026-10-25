import type { EntityManager, Repository } from 'typeorm';
import { UserEpisodeDownloadReceipt } from '../entities';

/** Idempotent: one receipt per user + episode. */
export async function recordEpisodeDownloadReceipt(
  repoOrManager: Repository<UserEpisodeDownloadReceipt> | EntityManager,
  input: {
    telegramUserId: string;
    episodeId: string;
    source: string;
  },
): Promise<void> {
  const repo =
    'getRepository' in repoOrManager
      ? repoOrManager.getRepository(UserEpisodeDownloadReceipt)
      : repoOrManager;

  const telegramUserId = String(input.telegramUserId);
  const episodeId = String(input.episodeId).trim();
  if (!episodeId) return;

  try {
    await repo.insert({
      telegramUserId,
      episodeId,
      source: input.source,
    });
  } catch {
    // duplicate primary key — already counted
  }
}
