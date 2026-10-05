import {
  explainExternalConnectivityFailure,
  formatExternalHttpError,
  isExternalTransportFailure,
  isPrivateExternalIp,
  normalizeExternalId,
} from './external-score.util';

describe('normalizeExternalId', () => {
  it('rejects empty and non-positive values', () => {
    expect(normalizeExternalId(null)).toBeNull();
    expect(normalizeExternalId(0)).toBeNull();
    expect(normalizeExternalId('')).toBeNull();
  });

  it('keeps a positive AniList or MAL id', () => {
    expect(normalizeExternalId(15125)).toBe(15125);
    expect(normalizeExternalId('5114')).toBe(5114);
  });
});

describe('formatExternalHttpError', () => {
  it('marks gateway failures as vendor timeouts', () => {
    expect(formatExternalHttpError(504)).toBe('HTTP 504 (vendor timeout)');
    expect(formatExternalHttpError(502)).toBe('HTTP 502 (vendor timeout)');
    expect(formatExternalHttpError(400)).toBe('HTTP 400');
  });
});

describe('explainExternalConnectivityFailure', () => {
  it('adds Persian hints for timeouts and DNS', () => {
    const timeout = explainExternalConnectivityFailure(
      'api.jikan.moe',
      'api.jikan.moe: Request timed out [ETIMEDOUT]',
    );
    expect(timeout).toContain('تایم‌اوت');
    expect(timeout).toContain('api.jikan.moe');

    const dns = explainExternalConnectivityFailure(
      'api.jikan.moe',
      'api.jikan.moe: getaddrinfo ENOTFOUND',
    );
    expect(dns).toContain('DNS');
  });
});

describe('isExternalTransportFailure', () => {
  it('treats status 0 and timeout text as transport errors', () => {
    expect(isExternalTransportFailure('anything', 0)).toBe(true);
    expect(isExternalTransportFailure('HTTP 429', 429)).toBe(false);
    expect(isExternalTransportFailure('api.jikan.moe: ETIMEDOUT', 0)).toBe(true);
  });
});

describe('isPrivateExternalIp', () => {
  it('rejects filtered IPv4 and loopback/ULA IPv6', () => {
    expect(isPrivateExternalIp('10.0.0.1')).toBe(true);
    expect(isPrivateExternalIp('192.168.1.1')).toBe(true);
    expect(isPrivateExternalIp('::1')).toBe(true);
    expect(isPrivateExternalIp('fd12:3456::1')).toBe(true);
    expect(isPrivateExternalIp('::ffff:10.1.2.3')).toBe(true);
  });

  it('allows public v4 and v6', () => {
    expect(isPrivateExternalIp('8.8.8.8')).toBe(false);
    expect(isPrivateExternalIp('2001:4860:4860::8888')).toBe(false);
  });
});
