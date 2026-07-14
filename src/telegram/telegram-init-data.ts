import { createHmac, timingSafeEqual } from 'crypto';

export type InitDataParseResult = {
  hash: string;
  authDate: number | null;
  userId: number | null;
  pairsEncoded: Array<{ key: string; value: string }>;
  pairsDecoded: Array<{ key: string; value: string }>;
  pairsNoSignatureDecoded: Array<{ key: string; value: string }>;
};

const decodeInitValue = (value: string): string =>
  decodeURIComponent(value.replace(/\+/g, ' '));

export const parseTelegramInitData = (
  initData: string,
): InitDataParseResult | null => {
  const raw = initData.trim();
  if (!raw) return null;

  const pairsEncoded: Array<{ key: string; value: string }> = [];
  const pairsDecoded: Array<{ key: string; value: string }> = [];
  const pairsNoSignatureDecoded: Array<{ key: string; value: string }> = [];
  let hash = '';
  let authDate: number | null = null;
  let userId: number | null = null;

  for (const part of raw.split('&')) {
    if (!part) continue;
    const eq = part.indexOf('=');
    if (eq <= 0) continue;

    const key = part.slice(0, eq);
    const valueEncoded = part.slice(eq + 1);

    if (key === 'hash') {
      hash = valueEncoded.toLowerCase();
      continue;
    }

    pairsEncoded.push({ key, value: valueEncoded });

    let valueDecoded = valueEncoded;
    try {
      valueDecoded = decodeInitValue(valueEncoded);
    } catch {
      valueDecoded = valueEncoded;
    }

    pairsDecoded.push({ key, value: valueDecoded });
    if (key !== 'signature') {
      pairsNoSignatureDecoded.push({ key, value: valueDecoded });
    }

    if (key === 'auth_date') {
      const ts = Number(valueEncoded);
      if (Number.isFinite(ts)) authDate = ts;
    }

    if (key === 'user') {
      try {
        const user = JSON.parse(valueDecoded) as { id?: number };
        if (typeof user.id === 'number' && user.id > 0) userId = user.id;
      } catch {
        // ignore
      }
    }
  }

  if (!hash) return null;

  return {
    hash,
    authDate,
    userId,
    pairsEncoded,
    pairsDecoded,
    pairsNoSignatureDecoded,
  };
};

const buildCheckString = (
  pairs: Array<{ key: string; value: string }>,
): string =>
  pairs
    .slice()
    .sort((a, b) => a.key.localeCompare(b.key))
    .map((p) => `${p.key}=${p.value}`)
    .join('\n');

const computeBotTokenHash = (
  botToken: string,
  checkString: string,
): string => {
  const secretKey = createHmac('sha256', 'WebAppData')
    .update(botToken.trim())
    .digest();
  return createHmac('sha256', secretKey).update(checkString).digest('hex');
};

const safeEqualHex = (a: string, b: string): boolean => {
  try {
    const bufA = Buffer.from(a, 'hex');
    const bufB = Buffer.from(b, 'hex');
    if (bufA.length !== bufB.length) return false;
    return timingSafeEqual(bufA, bufB);
  } catch {
    return false;
  }
};

export type TelegramInitDataVerifyResult = {
  userId: number | null;
  reason: string;
  method?: string;
};

export const verifyTelegramInitDataWithToken = (
  initData: string,
  botToken: string,
): TelegramInitDataVerifyResult => {
  const parsed = parseTelegramInitData(initData);
  if (!parsed) return { userId: null, reason: 'empty_or_invalid_init_data' };

  const token = botToken.trim();
  if (!token) return { userId: null, reason: 'bot_token_missing' };

  const candidates = [
    { mode: 'decoded_all', checkString: buildCheckString(parsed.pairsDecoded) },
    {
      mode: 'decoded_no_signature',
      checkString: buildCheckString(parsed.pairsNoSignatureDecoded),
    },
    { mode: 'encoded_all', checkString: buildCheckString(parsed.pairsEncoded) },
  ];

  for (const candidate of candidates) {
    const calcHash = computeBotTokenHash(token, candidate.checkString);
    if (safeEqualHex(calcHash, parsed.hash)) {
      if (parsed.authDate != null) {
        const ageSec = Math.abs(Math.floor(Date.now() / 1000) - parsed.authDate);
        if (ageSec > 604800) return { userId: null, reason: 'auth_date_expired' };
      }
      if (parsed.userId == null) return { userId: null, reason: 'invalid_user_id' };
      return { userId: parsed.userId, reason: 'ok', method: candidate.mode };
    }
  }

  return { userId: null, reason: 'hash_mismatch' };
};

export const verifyTelegramInitData = (
  initData: string,
  botToken: string | string[],
): TelegramInitDataVerifyResult => {
  const tokens = (Array.isArray(botToken) ? botToken : [botToken])
    .map((token) => token.trim())
    .filter(Boolean);

  if (tokens.length === 0) {
    return { userId: null, reason: 'bot_token_missing' };
  }

  let lastReason = 'hash_mismatch';
  for (const token of tokens) {
    const verified = verifyTelegramInitDataWithToken(initData, token);
    if (verified.userId != null) return verified;
    lastReason = verified.reason;
  }

  return { userId: null, reason: lastReason };
};
