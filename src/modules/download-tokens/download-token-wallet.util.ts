/** Download-token wallet rollout modes. */
export type DownloadTokenWalletMode = 'off' | 'allowlist' | 'on';

export const parseDownloadTokenWalletMode = (
  raw: string | undefined,
): DownloadTokenWalletMode => {
  const value = String(raw ?? 'off').trim().toLowerCase();
  if (value === 'on' || value === 'all' || value === 'true' || value === '1') {
    return 'on';
  }
  if (value === 'allowlist' || value === 'whitelist' || value === 'test') {
    return 'allowlist';
  }
  return 'off';
};

export const parseIdAllowlist = (raw: string | undefined): Set<string> => {
  const ids = String(raw ?? '')
    .split(/[,\s]+/)
    .map((part) => part.trim())
    .filter(Boolean);
  return new Set(ids);
};

export const isDownloadTokenWalletEnabledFor = (
  telegramUserId: string | number,
  mode: DownloadTokenWalletMode,
  allowlist: Set<string>,
): boolean => {
  const id = String(telegramUserId).trim();
  if (!id) return false;
  if (mode === 'on') return true;
  if (mode === 'allowlist') return allowlist.has(id);
  return false;
};

/** Extract telegram user id from a Daramet donation message. */
export const parseTelegramUserIdFromDonateMessage = (
  message: string | null | undefined,
): string | null => {
  const raw = String(message ?? '').trim();
  if (!raw) return null;
  if (/^\d{5,15}$/.test(raw)) return raw;
  const tagged = raw.match(/(?:^|[^\d])(?:tg[:\s#]*|telegram[:\s#]*)(\d{5,15})\b/i);
  if (tagged?.[1]) return tagged[1];
  // Prefer standalone id token (avoid matching long amounts inside prose).
  const bare = raw.match(/(?:^|\s)(\d{5,15})(?:\s|$)/);
  if (bare?.[1]) return bare[1];
  return null;
};

export const buildDarametWebIntentUrl = (input: {
  donateBaseUrl: string;
  amountIrr: number;
  message: string;
}): string => {
  const base = String(input.donateBaseUrl || 'https://daramet.com').trim() || 'https://daramet.com';
  const url = new URL(base.includes('://') ? base : `https://${base}`);
  url.searchParams.set('webintent', '');
  url.searchParams.set('donate', String(Math.floor(input.amountIrr)));
  url.searchParams.set('message', input.message);
  // Daramet expects `?webintent&donate=` (flag without value). URLSearchParams
  // may emit `webintent=`; normalize empty assignment away.
  return url
    .toString()
    .replace('webintent=&', 'webintent&')
    .replace(/([?&])webintent=$/, '$1webintent');
};
