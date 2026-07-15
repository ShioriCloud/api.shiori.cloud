import * as https from 'https';
import * as http from 'http';

export type ExternalScoreFetchError = {
  source: 'anilist' | 'mal';
  message: string;
};

export const normalizeExternalId = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
};

export const parseExternalScore = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  return Number.isFinite(n) && n > 0 ? n : null;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const jikanInsecureTlsEnabled = () =>
  process.env.EXTERNAL_SCORES_JIKAN_INSECURE_TLS === 'true';

const fetchJsonViaNodeHttp = async (
  url: string,
  init?: RequestInit & { timeoutMs?: number; insecureTls?: boolean },
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> => {
  const timeoutMs = init?.timeoutMs ?? 15_000;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;

  return new Promise((resolve) => {
    const req = transport.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: init?.headers as Record<string, string> | undefined,
        rejectUnauthorized: init?.insecureTls ? false : undefined,
      },
      (res) => {
        let text = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          text += chunk;
        });
        res.on('end', () => {
          let json: unknown = null;
          if (text.trim()) {
            try {
              json = JSON.parse(text);
            } catch {
              resolve({
                ok: false,
                status: res.statusCode ?? 0,
                json: null,
                error: `Invalid JSON (${res.statusCode ?? 0})`,
              });
              return;
            }
          }

          const status = res.statusCode ?? 0;
          if (status < 200 || status >= 300) {
            resolve({
              ok: false,
              status,
              json,
              error: `HTTP ${status}`,
            });
            return;
          }

          resolve({ ok: true, status, json });
        });
      },
    );

    const timer = setTimeout(() => {
      req.destroy(new Error('Request timed out'));
    }, timeoutMs);

    req.on('error', (error) => {
      clearTimeout(timer);
      resolve({
        ok: false,
        status: 0,
        json: null,
        error: error instanceof Error ? error.message : 'Request failed',
      });
    });

    req.on('close', () => clearTimeout(timer));

    if (init?.body) req.write(String(init.body));
    req.end();
  });
};

const fetchJson = async (
  url: string,
  init?: RequestInit & { timeoutMs?: number },
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> => {
  const timeoutMs = init?.timeoutMs ?? 15_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const res = await fetch(url, {
      ...init,
      signal: controller.signal,
      headers: {
        Accept: 'application/json',
        'User-Agent': 'ShioriAPI/1.0 (external-scores)',
        ...(init?.headers ?? {}),
      },
    });

    const text = await res.text();
    let json: unknown = null;
    if (text.trim()) {
      try {
        json = JSON.parse(text);
      } catch {
        return {
          ok: false,
          status: res.status,
          json: null,
          error: `Invalid JSON (${res.status})`,
        };
      }
    }

    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        json,
        error: `HTTP ${res.status}`,
      };
    }

    return { ok: true, status: res.status, json };
  } catch (error) {
    const message =
      error instanceof Error
        ? error.name === 'AbortError'
          ? 'Request timed out'
          : error.message
        : 'Request failed';
    return { ok: false, status: 0, json: null, error: message };
  } finally {
    clearTimeout(timer);
  }
};

export const fetchAnilistScorePercent = async (
  anilistId: number,
): Promise<{ score: number | null; error?: string }> => {
  const result = await fetchJson('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
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

  if (!result.ok) {
    return { score: null, error: result.error ?? `AniList HTTP ${result.status}` };
  }

  const json = result.json as {
    data?: { Media?: { meanScore?: number | null; averageScore?: number | null } };
    errors?: Array<{ message?: string }>;
  };

  if (json.errors?.length) {
    return { score: null, error: json.errors[0]?.message ?? 'AniList query error' };
  }

  const media = json.data?.Media;
  if (!media) return { score: null, error: 'AniList media not found' };

  const average = parseExternalScore(media.averageScore);
  if (average != null) return { score: average };

  const mean = parseExternalScore(media.meanScore);
  if (mean != null) return { score: mean };

  return { score: null, error: 'AniList score unavailable' };
};

export const fetchMalScoreFromJikan = async (
  malId: number,
  attempt = 0,
): Promise<{ score: number | null; error?: string }> => {
  const url = `https://api.jikan.moe/v4/anime/${malId}`;
  const result = jikanInsecureTlsEnabled()
    ? await fetchJsonViaNodeHttp(url, { insecureTls: true })
    : await fetchJson(url);

  if (result.status === 429 && attempt < 2) {
    await sleep(1_000 * (attempt + 1));
    return fetchMalScoreFromJikan(malId, attempt + 1);
  }

  if (!result.ok) {
    return { score: null, error: result.error ?? `Jikan HTTP ${result.status}` };
  }

  const json = result.json as { data?: { score?: unknown } };
  const score = parseExternalScore(json.data?.score);
  if (score != null) return { score };

  return { score: null, error: 'Jikan score unavailable' };
};

export type ResolvedExternalScoreIds = {
  anilist_id: number | null;
  mal_id: number | null;
};

export const resolveExternalScoreIds = (ids: {
  anilist_id?: unknown;
  mal_id?: unknown;
}): ResolvedExternalScoreIds => ({
  anilist_id: normalizeExternalId(ids.anilist_id),
  mal_id: normalizeExternalId(ids.mal_id),
});

type ExternalScoreFetchResult = { score: number | null; error?: string };

const emptyScoreResult = (): ExternalScoreFetchResult => ({ score: null });

export const fetchExternalScoresDetailed = async (ids: {
  anilist_id?: unknown;
  mal_id?: unknown;
}): Promise<{
  anilistScore: number | null;
  malScore: number | null;
  errors: ExternalScoreFetchError[];
}> => {
  const resolved = resolveExternalScoreIds(ids);
  const errors: ExternalScoreFetchError[] = [];

  const [anilistResult, malResult] = await Promise.all([
    resolved.anilist_id
      ? fetchAnilistScorePercent(resolved.anilist_id)
      : Promise.resolve(emptyScoreResult()),
    resolved.mal_id
      ? fetchMalScoreFromJikan(resolved.mal_id)
      : Promise.resolve(emptyScoreResult()),
  ]);

  if (resolved.anilist_id && anilistResult.error) {
    errors.push({ source: 'anilist', message: anilistResult.error });
  }
  if (resolved.mal_id && malResult.error) {
    errors.push({ source: 'mal', message: malResult.error });
  }

  return {
    anilistScore: anilistResult.score,
    malScore: malResult.score,
    errors,
  };
};
