/**
 * Build / mutate TheShioriSub-style HTML captions for channel drafts.
 */

/** Same IDs as tel-bot premiumEmojiDefaults (override via CUSTOM_EMOJI_* on API). */
const PREMIUM_EMOJI_IDS: Record<string, string> = {
  check: process.env.CUSTOM_EMOJI_CHECK?.trim() || '5206607081334906820',
  arrowDown: process.env.CUSTOM_EMOJI_ARROWDOWN?.trim() || '5406745015365943482',
};

const PREMIUM_EMOJI_FALLBACK: Record<string, string> = {
  check: '✔️',
  arrowDown: '⬇️',
};

const premiumEmoji = (name: 'check' | 'arrowDown') => {
  const fallback = PREMIUM_EMOJI_FALLBACK[name] ?? '';
  const id = PREMIUM_EMOJI_IDS[name];
  if (!id) return fallback;
  return `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
};

const escapeHtml = (value: string) =>
  String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

const tgLink = (url: string, label: string) =>
  `<a href="${escapeHtml(url)}">${escapeHtml(label)}</a>`;

export type TelegramMessageEntity = {
  type: string;
  offset: number;
  length: number;
  url?: string;
};

/** Convert Telegram caption + entities to simple HTML (bold + links). */
export const captionEntitiesToHtml = (
  caption: string,
  entities: TelegramMessageEntity[] = [],
): string => {
  const text = String(caption ?? '');
  if (!text) return '';
  if (!entities.length) return escapeHtml(text);

  const sorted = [...entities].sort(
    (a, b) => a.offset - b.offset || b.length - a.length,
  );

  let html = '';
  let cursor = 0;

  for (const ent of sorted) {
    const start = Math.max(0, ent.offset);
    const end = Math.min(text.length, ent.offset + ent.length);
    if (end <= cursor || start < cursor) continue;

    html += escapeHtml(text.slice(cursor, start));
    const slice = text.slice(start, end);
    const escaped = escapeHtml(slice);

    if (ent.type === 'text_link' && ent.url) {
      html += `<a href="${escapeHtml(ent.url)}">${escaped}</a>`;
    } else if (ent.type === 'url') {
      html += `<a href="${escapeHtml(slice)}">${escaped}</a>`;
    } else if (ent.type === 'bold' || ent.type === 'strong') {
      html += `<b>${escaped}</b>`;
    } else if (ent.type === 'italic') {
      html += `<i>${escaped}</i>`;
    } else if (ent.type === 'code') {
      html += `<code>${escaped}</code>`;
    } else {
      html += escaped;
    }
    cursor = end;
  }

  html += escapeHtml(text.slice(cursor));
  return html;
};

/** e.g. [1080p Softsub] — linked to the episode file */
const videoLabel = (videoFileType?: string | null) => {
  const t = String(videoFileType ?? 'softsub').toLowerCase();
  if (t === 'hardsub') return '[1080p Hardsub]';
  if (t === 'free') return '[1080p Free]';
  return '[1080p Softsub]';
};

/**
 * New / updated episode line:
 * ⬇️ <b>E05</b>: <a>[1080p Softsub]</a> | <a>Subtitle</a>
 * Subtitle segment omitted when subtitleUrl is empty.
 */
export const buildEpisodeCaptionLine = (opts: {
  episodeNumber: number;
  videoUrl: string;
  subtitleUrl?: string | null;
  videoFileType?: string | null;
  isNew?: boolean;
}): string => {
  const epLabel = String(opts.episodeNumber).padStart(2, '0');
  const marker =
    opts.isNew === false ? premiumEmoji('check') : premiumEmoji('arrowDown');
  const video = tgLink(opts.videoUrl, videoLabel(opts.videoFileType));
  if (opts.subtitleUrl?.trim()) {
    return `${marker} <b>E${epLabel}</b>: ${video} | ${tgLink(opts.subtitleUrl.trim(), 'Subtitle')}`;
  }
  return `${marker} <b>E${epLabel}</b>: ${video}`;
};

/**
 * Insert (or replace) an episode line in an existing HTML caption.
 * Places the new line after the last E## line when possible.
 */
export const appendEpisodeLineToCaption = (
  captionHtml: string,
  episodeLine: string,
  episodeNumber: number,
): string => {
  const raw = String(captionHtml ?? '').trimEnd();
  if (!raw) return episodeLine;

  const epLabel = String(episodeNumber).padStart(2, '0');
  const lines = raw.split(/\n/);
  const epLineRe = /E(\d{2})\b/i;
  const thisEpRe = new RegExp(`E${epLabel}\\b`, 'i');

  let lastEpIndex = -1;
  let thisEpIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (epLineRe.test(lines[i])) lastEpIndex = i;
    if (thisEpRe.test(lines[i])) thisEpIndex = i;
  }

  if (thisEpIndex >= 0) {
    lines[thisEpIndex] = episodeLine;
    return lines.join('\n');
  }

  if (lastEpIndex >= 0) {
    lines.splice(lastEpIndex + 1, 0, episodeLine);
    return lines.join('\n');
  }

  // Insert before donation / synopsis / hashtag footer when present.
  const footerRe = /(Donation|Synopsis|#)/i;
  let footerIndex = lines.findIndex((l) => footerRe.test(l));
  if (footerIndex > 0) {
    // Keep a blank line before footer if missing.
    const insertAt = lines[footerIndex - 1]?.trim() === '' ? footerIndex - 1 : footerIndex;
    lines.splice(insertAt, 0, episodeLine, '');
    return lines.join('\n');
  }

  return `${raw}\n${episodeLine}`;
};

export const buildMiniAppEpisodesUrl = (
  botUsername: string,
  catalogAnimeId: string,
): string => {
  const bot = String(botUsername || 'ShioriUploadBot').replace(/^@/, '');
  const id = String(catalogAnimeId).trim();
  return `https://t.me/${bot}?startapp=${encodeURIComponent(`anime_${id}_episodes`)}`;
};
