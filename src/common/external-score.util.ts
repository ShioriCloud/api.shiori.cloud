import * as dns from 'dns';
import { isIP } from 'net';
import * as https from 'https';
import * as http from 'http';

export const normalizeExternalId = (value: unknown): number | null => {
  if (value == null || value === '') return null;
  const n = typeof value === 'number' ? value : Number(String(value).trim());
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.floor(n);
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const insecureTlsEnabled = () =>
  process.env.ANILIST_INSECURE_TLS === 'true' ||
  process.env.EXTERNAL_SCORES_INSECURE_TLS === 'true' ||
  process.env.EXTERNAL_SCORES_JIKAN_INSECURE_TLS === 'true';

type ResolvedHost = { address: string; family: 4 | 6 };

/** Reject RFC1918 / loopback / link-local / ULA so we never pin a filtered DNS sinkhole. */
export const isPrivateExternalIp = (ip: string): boolean => {
  const version = isIP(ip);
  if (!version) return false;

  if (version === 6) {
    const normalized = ip.toLowerCase();
    if (normalized === '::1' || normalized === '::') return true;
    if (/^fe[89ab]/i.test(normalized)) return true;
    if (normalized.startsWith('fc') || normalized.startsWith('fd')) return true;
    const mapped = normalized.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateExternalIp(mapped[1]);
    return false;
  }

  if (ip.startsWith('10.')) return true;
  if (ip.startsWith('127.')) return true;
  if (ip.startsWith('192.168.')) return true;
  if (ip.startsWith('169.254.')) return true;
  const [first, second] = ip.split('.').map(Number);
  return first === 172 && second >= 16 && second <= 31;
};

export const formatExternalHttpError = (status: number): string => {
  if (status === 502 || status === 503 || status === 504) {
    return `HTTP ${status} (vendor timeout)`;
  }
  return `HTTP ${status}`;
};

const parsePublicDnsServers = (): string[] => {
  const raw = (
    process.env.ANILIST_DNS_SERVERS ?? process.env.EXTERNAL_SCORES_DNS_SERVERS
  )?.trim();
  if (raw) {
    const servers = raw.split(',').map((entry) => entry.trim()).filter(Boolean);
    if (servers.length > 0) return servers;
  }
  return ['8.8.8.8', '1.1.1.1'];
};

const publicDnsResolver = new dns.Resolver();
publicDnsResolver.setServers(parsePublicDnsServers());

const resolveFamilyViaPublicDns = (hostname: string, family: 4 | 6): Promise<string> =>
  new Promise((resolve, reject) => {
    const onResolved = (error: NodeJS.ErrnoException | null, addresses?: string[]) => {
      if (error) {
        reject(error);
        return;
      }

      const publicIp = addresses?.find((ip) => !isPrivateExternalIp(ip));
      if (!publicIp) {
        reject(new Error(`No public IPv${family} for ${hostname}`));
        return;
      }

      resolve(publicIp);
    };

    if (family === 4) {
      publicDnsResolver.resolve4(hostname, onResolved);
    } else {
      publicDnsResolver.resolve6(hostname, onResolved);
    }
  });

const tryResolveFamily = async (hostname: string, family: 4 | 6): Promise<string | null> => {
  try {
    const { address } = await dns.promises.lookup(hostname, { family });
    if (!isPrivateExternalIp(address)) return address;
  } catch {
    // Some hosts rewrite blocked domains to 10.x — try public DNS next.
  }

  try {
    return await resolveFamilyViaPublicDns(hostname, family);
  } catch {
    return null;
  }
};

/**
 * Prefer IPv4 first because some production/corporate resolvers return private
 * A records for blocked domains. Also collect IPv6 so AniList still works when
 * graphql.anilist.co is AAAA-only (or IPv4 is filtered). Node Happy Eyeballs
 * can try both when lookup is called with `all: true`.
 */
const resolveExternalHostAddresses = async (hostname: string): Promise<ResolvedHost[]> => {
  const [ipv4, ipv6] = await Promise.all([
    tryResolveFamily(hostname, 4),
    tryResolveFamily(hostname, 6),
  ]);
  const addresses: ResolvedHost[] = [];
  if (ipv4) addresses.push({ address: ipv4, family: 4 });
  if (ipv6) addresses.push({ address: ipv6, family: 6 });
  if (addresses.length === 0) {
    throw new Error(`No public IPv4 or IPv6 for ${hostname}`);
  }
  return addresses;
};

const externalHostLookup: https.AgentOptions['lookup'] = (hostname, options, callback) => {
  resolveExternalHostAddresses(hostname)
    .then((addresses) => {
      if (options?.all) {
        callback(null, addresses);
        return;
      }
      const preferred = addresses.find((entry) => entry.family === 4) ?? addresses[0];
      callback(null, preferred.address, preferred.family);
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
              lookup: externalHostLookup,
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
              error: formatExternalHttpError(status),
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

/** Shared AniList GraphQL POST (import/search/fill + retries). */
export const anilistGraphqlRequest = async (
  query: string,
  variables: Record<string, unknown>,
): Promise<{ ok: boolean; status: number; json: unknown; error?: string }> =>
  requestJsonWithRetry('https://graphql.anilist.co', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({ query, variables }),
    insecureTls: insecureTlsEnabled(),
  });
