/**
 * Jikan v4 client (unofficial MyAnimeList API).
 * https://docs.api.jikan.moe/
 */

import { externalHttpGetJson } from './external-score.util';

const defaultJikanBase = 'https://api.jikan.moe/v4';

const jikanBaseUrl = (): string => {
  const raw = String(process.env.JIKAN_BASE_URL ?? '').trim().replace(/\/+$/, '');
  return raw || defaultJikanBase;
};

export type JikanRequestOptions = {
  signal?: AbortSignal;
  timeoutMs?: number;
};

const LOCAL_FORMATS = new Set(['TV', 'MOVIE', 'ONA', 'OVA', 'SPECIAL']);
const LOCAL_SEASONS = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);

const FORMAT_ALIASES: Record<string, string> = {
  TV: 'TV',
  MOVIE: 'MOVIE',
  ONA: 'ONA',
  OVA: 'OVA',
  SPECIAL: 'SPECIAL',
  TV_SPECIAL: 'SPECIAL',
};

export type MalMappedMedia = {
  mal_id: number;
  anilist_id: number | null;
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
  genres: string[];
  studios: string[];
};

export class JikanClientError extends Error {
  constructor(
    message: string,
    readonly status = 0,
  ) {
    super(message);
    this.name = 'JikanClientError';
  }
}

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

const positiveInt = (value: unknown): number | null => {
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : null;
};

const mapStatus = (raw: unknown): string | null => {
  const v = String(raw ?? '')
    .trim()
    .toLowerCase();
  if (!v) return null;
  if (v.includes('currently airing') || v === 'airing') return 'RELEASING';
  if (v.includes('finished')) return 'FINISHED';
  if (v.includes('not yet') || v.includes('upcoming')) return 'NOT_YET_RELEASED';
  return null;
};

const mapFormat = (raw: unknown): string | null => {
  const key = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, '_');
  const mapped = FORMAT_ALIASES[key] ?? key;
  return LOCAL_FORMATS.has(mapped) ? mapped : null;
};

const mapSeason = (raw: unknown): string | null => {
  const key = String(raw ?? '')
    .trim()
    .toUpperCase();
  return LOCAL_SEASONS.has(key) ? key : null;
};

const isoDateOnly = (raw: unknown): string | null => {
  const text = String(raw ?? '').trim();
  if (!text) return null;
  const match = text.match(/^(\d{4}-\d{2}-\d{2})/);
  return match?.[1] ?? null;
};

const stripHtml = (value: string | null | undefined): string | null => {
  if (!value) return null;
  const cleaned = value
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/?[^>]+>/g, '')
    .replace(/\r\n/g, '\n')
    .trim();
  return cleaned || null;
};

const mapJikanAnime = (rawUnknown: unknown): MalMappedMedia | null => {
  const raw = asRecord(rawUnknown);
  if (!raw) return null;
  const malId = positiveInt(raw.mal_id);
  if (!malId) return null;

  const images = asRecord(raw.images);
  const jpg = asRecord(images?.jpg);
  const webp = asRecord(images?.webp);
  const cover =
    String(jpg?.large_image_url ?? jpg?.image_url ?? webp?.large_image_url ?? '').trim() ||
    null;

  const titleDefault = String(raw.title ?? '').trim();
  const titleEnglish = String(raw.title_english ?? '').trim();
  const titleJapanese = String(raw.title_japanese ?? '').trim();
  const title = titleEnglish || titleDefault || titleJapanese;
  if (!title) return null;

  const genres = Array.isArray(raw.genres)
    ? raw.genres
        .map((g) => String(asRecord(g)?.name ?? '').trim())
        .filter(Boolean)
    : [];
  const studios = Array.isArray(raw.studios)
    ? raw.studios
        .map((s) => String(asRecord(s)?.name ?? '').trim())
        .filter(Boolean)
    : [];

  const aired = asRecord(raw.aired);

  return {
    mal_id: malId,
    anilist_id: null,
    title,
    title_romaji: titleDefault || null,
    title_native: titleJapanese || null,
    synonyms: Array.isArray(raw.title_synonyms)
      ? raw.title_synonyms.map((s) => String(s).trim()).filter(Boolean)
      : [],
    synopsis: stripHtml(String(raw.synopsis ?? '')),
    cover_image: cover,
    featured_image: cover,
    format: mapFormat(raw.type),
    season: mapSeason(raw.season),
    year: positiveInt(raw.year),
    airing_status: mapStatus(raw.status),
    episodes_count: positiveInt(raw.episodes),
    start_date: isoDateOnly(aired?.from),
    end_date: isoDateOnly(aired?.to),
    genres,
    studios,
  };
};

const jikanFetch = async (path: string, options?: JikanRequestOptions): Promise<unknown> => {
  const url = `${jikanBaseUrl()}${path}`;
  const result = await externalHttpGetJson(url, {
    signal: options?.signal,
    timeoutMs: options?.timeoutMs ?? 20_000,
  });

  if (result.error === 'Request aborted') {
    throw new JikanClientError('Request aborted', 0);
  }

  if (!result.ok) {
    throw new JikanClientError(
      result.error ?? (result.status ? `Jikan HTTP ${result.status}` : 'Jikan unavailable'),
      result.status,
    );
  }

  return result.json;
};

export const searchMalAnime = async (
  query: string,
  limit = 12,
  options?: JikanRequestOptions,
): Promise<MalMappedMedia[]> => {
  const q = query.trim();
  if (q.length < 2) return [];

  const qs = new URLSearchParams({
    q,
    limit: String(Math.min(Math.max(limit, 1), 25)),
    sfw: 'true',
  });
  const json = asRecord(await jikanFetch(`/anime?${qs.toString()}`, options));
  const rows = Array.isArray(json?.data) ? json.data : [];
  return rows
    .map((row) => mapJikanAnime(row))
    .filter((row): row is MalMappedMedia => row != null);
};

export const fetchMalAnimeById = async (
  malId: number,
  options?: JikanRequestOptions,
): Promise<MalMappedMedia | null> => {
  const id = positiveInt(malId);
  if (!id) return null;
  const json = asRecord(await jikanFetch(`/anime/${id}/full`, options));
  return mapJikanAnime(json?.data);
};

/** MAL score is typically 0–10. Returns null when Jikan has no score. */
export const fetchMalScoreById = async (
  malId: number,
  options?: JikanRequestOptions,
): Promise<number | null> => {
  const id = positiveInt(malId);
  if (!id) return null;
  const json = asRecord(await jikanFetch(`/anime/${id}`, options));
  const data = asRecord(json?.data);
  if (!data) return null;
  const score = typeof data.score === 'number' ? data.score : Number(data.score);
  if (!Number.isFinite(score) || score <= 0) return null;
  return Math.round(score * 100) / 100;
};
