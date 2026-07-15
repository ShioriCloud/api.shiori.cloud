import * as dns from 'dns';
import { isIP } from 'net';
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

const insecureTlsEnabled = () =>
  process.env.EXTERNAL_SCORES_INSECURE_TLS === 'true' ||
  process.env.EXTERNAL_SCORES_JIKAN_INSECURE_TLS === 'true';

const isPrivateIp = (ip: string): boolean => {
  if (!isIP(ip)) return false;
  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const [first, second] = ip.split('.').map(Number);
  return first === 172 && second >= 16 && second <= 31;
};

const parsePublicDnsServers = (): string[] => {
  const raw = process.env.EXTERNAL_SCORES_DNS_SERVERS?.trim();
  if (raw) {
    const servers = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (servers.length > 0) return servers;
  }
  return ['8.8.8.8', '1.1.1.1'];
};

const publicDnsResolver = new dns.Resolver();
publicDnsResolver.setServers(parsePublicDnsServers());

const resolveIpv4ViaPublicDns = (hostname: string): Promise<string> =>
  new Promise((resolve, reject) => {
    publicDnsResolver.resolve4(hostname, (error, addresses) => {
      if (error) {
        reject(error);
        return;
      }

      const publicIp = addresses?.find((ip) => !isPrivateIp(ip));
      if (!publicIp) {
        reject(new Error(`No public IPv4 for ${hostname}`));
        return;
      }

      resolve(publicIp);
    });
  });

const resolveExternalHostnameIpv4 = async (hostname: string): Promise<string> => {
  try {
    const { address } = await dns.promises.lookup(hostname, { family: 4 });
    if (!isPrivateIp(address)) return address;
  } catch {
    // Fall back to public DNS below.
  }

  return resolveIpv4ViaPublicDns(hostname);
};

const externalIpv4Lookup: https.AgentOptions['lookup'] = (hostname, options, callback) => {
  resolveExternalHostnameIpv4(hostname)
    .then((address) => {
      if (options?.all) {
        callback(null, [{ address, family: 4 }]);
        return;
      }
      callback(null, address, 4);
    })
    .catch((error) => {
      callback(error as NodeJS.ErrnoException, '', 4);
    });
};

const formatRequestError = (error: unknown): string => {
  if (!(error instanceof Error)) return 'Request failed';

  const cause = (error as Error & { cause?: unknown }).cause;
  if (cause instanceof Error && cause.message && cause.message !== error.message) {
    return `${error.message} (${cause.message})`;
  }
  if (typeof cause === 'object' && cause && 'code' in cause) {
    const code = String((cause as { code?: unknown }).code ?? '');
    if (code && !error.message.includes(code)) {
      return `${error.message} (${code})`;
    }
  }

  return error.message;
};

const requestJson = async (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    timeoutMs?: number;
    insecureTls?: boolean;
  },
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> => {
  const timeoutMs = init?.timeoutMs ?? 25_000;
  const parsed = new URL(url);
  const isHttps = parsed.protocol === 'https:';
  const transport = isHttps ? https : http;
  const useInsecureTls = init?.insecureTls ?? false;

  return new Promise((resolve) => {
    const req = transport.request(
      url,
      {
        method: init?.method ?? 'GET',
        headers: init?.headers,
        agent: isHttps
          ? new https.Agent({
              rejectUnauthorized: !useInsecureTls,
              lookup: externalIpv4Lookup,
            })
          : undefined,
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
        error: formatRequestError(error),
      });
    });

    req.on('close', () => clearTimeout(timer));

    if (init?.body) req.write(init.body);
    req.end();
  });
};

const shouldRetryStatus = (status: number) =>
  status === 429 || status === 502 || status === 503 || status === 504;

const requestJsonWithRetry = async (
  url: string,
  init?: Parameters<typeof requestJson>[1],
  attempt = 0,
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> => {
  const result = await requestJson(url, init);

  if (result.ok) return result;
  if (attempt >= 2) return result;
  if (result.status > 0 && !shouldRetryStatus(result.status)) return result;
  if (result.status === 0 && attempt >= 1) return result;

  await sleep(result.status === 429 ? 1_000 * (attempt + 1) : 750 * (attempt + 1));
  return requestJsonWithRetry(url, init, attempt + 1);
};

export const fetchAnilistScorePercent = async (
  anilistId: number,
): Promise<{ score: number | null; error?: string }> => {
  const result = await requestJsonWithRetry('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
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
    insecureTls: insecureTlsEnabled(),
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
  const result = await requestJsonWithRetry(url, {
    headers: { Accept: 'application/json' },
    insecureTls: insecureTlsEnabled(),
  });

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
