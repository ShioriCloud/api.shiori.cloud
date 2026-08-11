/**
 * Build / mutate TheShioriSub-style HTML captions for channel drafts.
 */

/** Same IDs as tel-bot premiumEmojiDefaults (override via CUSTOM_EMOJI_* on API). */
const PREMIUM_EMOJI_IDS: Record<string, string> = {
  success: process.env.CUSTOM_EMOJI_SUCCESS?.trim() || '5206607081334906820',
  check: process.env.CUSTOM_EMOJI_CHECK?.trim() || '5206607081334906820',
  arrowDown: process.env.CUSTOM_EMOJI_ARROWDOWN?.trim() || '5406745015365943482',
  comet: process.env.CUSTOM_EMOJI_COMET?.trim() || '5224607267797606837',
  pencil: process.env.CUSTOM_EMOJI_PENCIL?.trim() || '5395444784611480792',
  package: process.env.CUSTOM_EMOJI_PACKAGE?.trim() || '5256094480498436162',
  download: process.env.CUSTOM_EMOJI_DOWNLOAD?.trim() || '5256094480498436162',
  cool: process.env.CUSTOM_EMOJI_COOL?.trim() || '5222079954421818267',
  heart: process.env.CUSTOM_EMOJI_HEART?.trim() || '5222079954421818267',
  donation: process.env.CUSTOM_EMOJI_DONATION?.trim() || '5267102644886853973',
  speech: process.env.CUSTOM_EMOJI_SPEECH?.trim() || '5460795800101594035',
  flag: process.env.CUSTOM_EMOJI_FLAG?.trim() || '5190604119089358564',
  stop: process.env.CUSTOM_EMOJI_STOP?.trim() || '5260293700088511294',
};

const PREMIUM_EMOJI_FALLBACK: Record<string, string> = {
  success: '✅',
  check: '✔️',
  arrowDown: '⬇️',
  comet: '☄️',
  pencil: '✏️',
  package: '📦',
  download: '📥',
  cool: '🆒',
  heart: '❤️',
  donation: '❤️',
  speech: '🗣️',
  flag: '🚩',
  stop: '⛔️',
};

const premiumEmoji = (name: keyof typeof PREMIUM_EMOJI_FALLBACK) => {
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
  custom_emoji_id?: string;
  customEmojiId?: string;
};

/** Convert Telegram caption + entities to HTML (bold, links, premium emoji). */
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
    const customId = String(
      ent.custom_emoji_id ?? ent.customEmojiId ?? '',
    ).trim();

    if (ent.type === 'custom_emoji' && customId) {
      html += `<tg-emoji emoji-id="${escapeHtml(customId)}">${escaped}</tg-emoji>`;
    } else if (ent.type === 'text_link' && ent.url) {
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

/**
 * Upgrade plain unicode schedule emojis to &lt;tg-emoji&gt; (for templates
 * bound before custom_emoji was preserved, or captions without entities).
 */
export const upgradeKnownEmojisToPremiumHtml = (htmlCaption: string): string => {
  const src = String(htmlCaption ?? '');
  if (!src) return src;

  const parts = src.split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/g);
  // Longer / more specific fallbacks first (e.g. ✔️ before ✅ if overlapping — they don't)
  const entries = Object.entries(PREMIUM_EMOJI_FALLBACK)
    .map(([name, fallback]) => ({
      name,
      fallback,
      id: PREMIUM_EMOJI_IDS[name],
    }))
    .filter((e) => e.id && e.fallback)
    .sort((a, b) => b.fallback.length - a.fallback.length);

  return parts
    .map((part) => {
      if (part.startsWith('<tg-emoji')) return part;
      let out = part;
      for (const { fallback, id } of entries) {
        if (!out.includes(fallback)) continue;
        const tag = `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
        out = out.split(fallback).join(tag);
      }
      return out;
    })
    .join('');
};

/** Always Softsub in channel post template (panel media type is ignored). */
const videoLabel = (_videoFileType?: string | null) => '[1080p][Softsub]';

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
  const bot = String(botUsername || 'ShioriMiniBot').replace(/^@/, '');
  const id = String(catalogAnimeId).trim();
  return `https://t.me/${bot}?startapp=${encodeURIComponent(`anime_${id}_episodes`)}`;
};
