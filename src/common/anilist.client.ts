import { anilistGraphqlRequest } from './external-score.util';

const LOCAL_FORMATS = new Set(['TV', 'MOVIE', 'ONA', 'OVA', 'SPECIAL']);
const LOCAL_SEASONS = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);
const LOCAL_STATUSES = new Set(['RELEASING', 'FINISHED', 'NOT_YET_RELEASED']);

const FORMAT_ALIASES: Record<string, string> = {
  TV: 'TV',
  TV_SHORT: 'TV',
  MOVIE: 'MOVIE',
  SPECIAL: 'SPECIAL',
  OVA: 'OVA',
  ONA: 'ONA',
};

export type AnilistMappedMedia = {
  anilist_id: number;
  mal_id: number | null;
  title: string;
  title_romaji: string | null;
  title_native: string | null;
  synonyms: string[];
  synopsis: string | null;
  cover_image: string | null;
  featured_image: string | null;
  format: string | null;
  season: string | null;
  year: number | null;
  airing_status: string | null;
  episodes_count: number | null;
  start_date: string | null;
  end_date: string | null;
  anilist_genres: string[];
  anilist_studios: string[];
};

type AnilistTitle = {
  romaji?: string | null;
  english?: string | null;
  native?: string | null;
};

type AnilistFuzzyDate = {
  year?: number | null;
  month?: number | null;
  day?: number | null;
};

type AnilistRawMedia = {
  id?: number;
  idMal?: number | null;
  title?: AnilistTitle | null;
  synonyms?: string[] | null;
  description?: string | null;
  coverImage?: { extraLarge?: string | null; large?: string | null } | null;
  bannerImage?: string | null;
  format?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  status?: string | null;
  episodes?: number | null;
  genres?: string[] | null;
  startDate?: AnilistFuzzyDate | null;
  endDate?: AnilistFuzzyDate | null;
  studios?: { nodes?: Array<{ name?: string | null } | null> | null } | null;
};

const MEDIA_FIELDS = `
  id
  idMal
  title { romaji english native }
  synonyms
  description(asHtml: false)
  coverImage { extraLarge large }
  bannerImage
  format
  season
  seasonYear
  status
  episodes
  genres
  startDate { year month day }
  endDate { year month day }
  studios(isMain: true) { nodes { name } }
`;

const SEARCH_QUERY = `
  query ($search: String, $page: Int, $perPage: Int) {
    Page(page: $page, perPage: $perPage) {
      media(search: $search, type: ANIME, sort: SEARCH_MATCH) {
        ${MEDIA_FIELDS}
      }
    }
  }
`;

const MEDIA_BY_ID_QUERY = `
  query ($id: Int) {
    Media(id: $id, type: ANIME) {
      ${MEDIA_FIELDS}
    }
  }
`;

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

const stripDescription = (raw: string | null | undefined): string | null => {
  if (!raw) return null;
  const text = raw
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text || null;
};

const formatDate = (date?: AnilistFuzzyDate | null): string | null => {
  const year = positiveInt(date?.year);
  if (!year) return null;
  const monthRaw = Number(date?.month);
  const dayRaw = Number(date?.day);
  const month =
    Number.isFinite(monthRaw) && monthRaw >= 1 && monthRaw <= 12 ? Math.trunc(monthRaw) : 1;
  const day = Number.isFinite(dayRaw) && dayRaw >= 1 && dayRaw <= 31 ? Math.trunc(dayRaw) : 1;
  return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
};

const mapFormat = (value: string | null | undefined): string | null => {
  const raw = trimOrNull(value)?.toUpperCase() ?? null;
  if (!raw) return null;
  const mapped = FORMAT_ALIASES[raw] ?? raw;
  return LOCAL_FORMATS.has(mapped) ? mapped : null;
};

const mapSeason = (value: string | null | undefined): string | null => {
  const raw = trimOrNull(value)?.toUpperCase() ?? null;
  return raw && LOCAL_SEASONS.has(raw) ? raw : null;
};

const mapStatus = (value: string | null | undefined): string | null => {
  const raw = trimOrNull(value)?.toUpperCase() ?? null;
  return raw && LOCAL_STATUSES.has(raw) ? raw : null;
};

export const mapAnilistMedia = (raw: AnilistRawMedia | null | undefined): AnilistMappedMedia | null => {
  const anilistId = positiveInt(raw?.id);
  if (!anilistId) return null;

  const romaji = trimOrNull(raw?.title?.romaji);
  const english = trimOrNull(raw?.title?.english);
  const native = trimOrNull(raw?.title?.native);
  const title = english ?? romaji ?? native;
  if (!title) return null;

  const synonyms = (raw?.synonyms ?? [])
    .map((item) => trimOrNull(item))
    .filter((item): item is string => Boolean(item));

  const studios = (raw?.studios?.nodes ?? [])
    .map((node) => trimOrNull(node?.name))
    .filter((item): item is string => Boolean(item));

  const genres = (raw?.genres ?? [])
    .map((item) => trimOrNull(item))
    .filter((item): item is string => Boolean(item));

  const year = positiveInt(raw?.seasonYear) ?? positiveInt(raw?.startDate?.year);

  return {
    anilist_id: anilistId,
    mal_id: positiveInt(raw?.idMal),
    title,
    title_romaji: romaji,
    title_native: native,
    synonyms,
    synopsis: stripDescription(raw?.description),
    cover_image: trimOrNull(raw?.coverImage?.extraLarge) ?? trimOrNull(raw?.coverImage?.large),
    featured_image: trimOrNull(raw?.bannerImage),
    format: mapFormat(raw?.format),
    season: mapSeason(raw?.season),
    year,
    airing_status: mapStatus(raw?.status),
    episodes_count: positiveInt(raw?.episodes),
    start_date: formatDate(raw?.startDate),
    end_date: formatDate(raw?.endDate),
    anilist_genres: genres,
    anilist_studios: studios,
  };
};

export const searchAnilistAnime = async (
  search: string,
  perPage = 10,
): Promise<AnilistMappedMedia[]> => {
  const data = await parseGraphql<{ Page?: { media?: AnilistRawMedia[] | null } | null }>(
    SEARCH_QUERY,
    { search, page: 1, perPage },
  );
  return (data.Page?.media ?? [])
    .map((media) => mapAnilistMedia(media))
    .filter((item): item is AnilistMappedMedia => Boolean(item));
};

export const fetchAnilistAnimeById = async (
  anilistId: number,
): Promise<AnilistMappedMedia | null> => {
  const data = await parseGraphql<{ Media?: AnilistRawMedia | null }>(MEDIA_BY_ID_QUERY, {
    id: anilistId,
  });
  return mapAnilistMedia(data.Media);
};

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
