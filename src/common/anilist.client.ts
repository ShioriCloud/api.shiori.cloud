import { anilistGraphqlRequest } from './external-score.util';

type AnilistTitle = {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
};

export class AnilistClientError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'AnilistClientError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const readGraphqlErrors = (json: unknown): string | null => {
  const root = asRecord(json);
  const errors = root?.errors;
  if (!Array.isArray(errors) || errors.length === 0) return null;
  const first = asRecord(errors[0]);
  const message = first?.message;
  return typeof message === 'string' && message.trim() ? message.trim() : 'AniList query error';
};

const parseGraphql = async <T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> => {
  const result = await anilistGraphqlRequest(query, variables);
  if (!result.ok) {
    throw new AnilistClientError(
      result.error ?? `AniList HTTP ${result.status}`,
      result.status,
    );
  }
  const gqlError = readGraphqlErrors(result.json);
  if (gqlError) {
    throw new AnilistClientError(gqlError, result.status);
  }
  const root = asRecord(result.json);
  const data = root?.data;
  if (!data) {
    throw new AnilistClientError('AniList response missing data', result.status);
  }
  return data as T;
};

const trimOrNull = (value: unknown): string | null => {
  if (value == null) return null;
  const text = String(value).trim();
  return text || null;
};

const positiveInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.trunc(n);
};

const SCORE_BY_MAL_ID_QUERY = `
  query ($idMal: Int) {
    Media(idMal: $idMal, type: ANIME) {
      averageScore
    }
  }
`;

const SCORES_BY_IDS_QUERY = `
  query ($ids: [Int], $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(id_in: $ids, type: ANIME) {
        id
        averageScore
        title { romaji english native }
      }
    }
  }
`;

export type AnilistScoreRow = {
  anilist_id: number;
  average_score: number | null;
  title: string | null;
};

/** MAL-scale 0–10 from AniList idMal when Jikan is unreachable. */
export const fetchMalScoreByAnilistMalId = async (malId: number): Promise<number | null> => {
  const id = positiveInt(malId);
  if (!id) return null;

  const data = await parseGraphql<{ Media?: { averageScore?: number | null } | null }>(
    SCORE_BY_MAL_ID_QUERY,
    { idMal: id },
  );

  const scoreRaw = data.Media?.averageScore;
  if (typeof scoreRaw !== 'number' || !Number.isFinite(scoreRaw) || scoreRaw <= 0) {
    return null;
  }
  const malScale = scoreRaw / 10;
  return Math.round(malScale * 100) / 100;
};

/** AniList averageScore is 0–100. Batches up to 50 IDs per request. */
export const fetchAnilistScoresByIds = async (
  anilistIds: number[],
): Promise<AnilistScoreRow[]> => {
  const ids = [
    ...new Set(
      anilistIds
        .map((id) => positiveInt(id))
        .filter((id): id is number => id != null),
    ),
  ];
  if (ids.length === 0) return [];

  const perPage = Math.min(ids.length, 50);
  const data = await parseGraphql<{
    Page?: {
      media?: Array<{
        id?: number;
        averageScore?: number | null;
        title?: AnilistTitle | null;
      } | null> | null;
    } | null;
  }>(SCORES_BY_IDS_QUERY, { ids, page: 1, perPage });

  return (data.Page?.media ?? [])
    .map((row) => {
      const anilistId = positiveInt(row?.id);
      if (!anilistId) return null;
      const english = trimOrNull(row?.title?.english);
      const romaji = trimOrNull(row?.title?.romaji);
      const native = trimOrNull(row?.title?.native);
      const scoreRaw = row?.averageScore;
      const score =
        typeof scoreRaw === 'number' && Number.isFinite(scoreRaw) && scoreRaw > 0
          ? scoreRaw
          : null;
      return {
        anilist_id: anilistId,
        average_score: score,
        title: english ?? romaji ?? native,
      } satisfies AnilistScoreRow;
    })
    .filter((row): row is AnilistScoreRow => row != null);
};
