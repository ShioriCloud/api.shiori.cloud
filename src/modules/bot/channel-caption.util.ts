/**
 * Build / mutate TheShioriSub-style HTML captions for channel drafts.
 */

/** Same IDs as tel-bot premiumEmojiDefaults (override via CUSTOM_EMOJI_* on API). */
const PREMIUM_EMOJI_IDS: Record<string, string> = {
  success: process.env.CUSTOM_EMOJI_SUCCESS?.trim() || '5206607081334906820',
  check: process.env.CUSTOM_EMOJI_CHECK?.trim() || '5206607081334906820',
  arrowDown:
    process.env.CUSTOM_EMOJI_ARROWDOWN?.trim() || '5406745015365943482',
  comet: process.env.CUSTOM_EMOJI_COMET?.trim() || '5224607267797606837',
  pencil: process.env.CUSTOM_EMOJI_PENCIL?.trim() || '5395444784611480792',
  package: process.env.CUSTOM_EMOJI_PACKAGE?.trim() || '5256094480498436162',
  download: process.env.CUSTOM_EMOJI_DOWNLOAD?.trim() || '5256094480498436162',
  cool: process.env.CUSTOM_EMOJI_COOL?.trim() || '5222079954421818267',
  heart: process.env.CUSTOM_EMOJI_HEART?.trim() || '5222079954421818267',
  donation: process.env.CUSTOM_EMOJI_DONATION?.trim() || '5267102644886853973',
  speech: process.env.CUSTOM_EMOJI_SPEECH?.trim() || '5460795800101594035',
  /** Speech-bubble used before @TheShioriSub in channel posts */
  chat: process.env.CUSTOM_EMOJI_CHAT?.trim() || '5215334566549540768',
  flag: process.env.CUSTOM_EMOJI_FLAG?.trim() || '5190604119089358564',
  stop: process.env.CUSTOM_EMOJI_STOP?.trim() || '5260293700088511294',
  /** Marker before "S01: Episode [01-12]" pack line */
  seasonEpisode:
    process.env.CUSTOM_EMOJI_SEASON_EPISODE?.trim() || '5350572310627632617',
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
  chat: '💬',
  flag: '🚩',
  stop: '⛔️',
  seasonEpisode: '✅',
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

const openEntityTag = (ent: TelegramMessageEntity, slice: string): string => {
  const customId = String(
    ent.custom_emoji_id ?? ent.customEmojiId ?? '',
  ).trim();
  if (ent.type === 'custom_emoji' && customId) {
    return `<tg-emoji emoji-id="${escapeHtml(customId)}">`;
  }
  if (ent.type === 'text_link' && ent.url) {
    return `<a href="${escapeHtml(ent.url)}">`;
  }
  if (ent.type === 'url') {
    return `<a href="${escapeHtml(slice)}">`;
  }
  if (ent.type === 'bold' || ent.type === 'strong') return '<b>';
  if (ent.type === 'italic') return '<i>';
  if (ent.type === 'code') return '<code>';
  return '';
};

const closeEntityTag = (ent: TelegramMessageEntity): string => {
  if (ent.type === 'custom_emoji') return '</tg-emoji>';
  if (ent.type === 'text_link' || ent.type === 'url') return '</a>';
  if (ent.type === 'bold' || ent.type === 'strong') return '</b>';
  if (ent.type === 'italic') return '</i>';
  if (ent.type === 'code') return '</code>';
  return '';
};

type MappedEntity = {
  id: number;
  ent: TelegramMessageEntity;
  start: number;
  end: number;
  len: number;
};

/**
 * Convert Telegram caption + entities to HTML (bold, links, premium emoji).
 * Uses a stack so overlapping (crossing) bold/link ranges never emit
 * `&lt;a&gt;&lt;b&gt;…&lt;/a&gt;&lt;/b&gt;` — Telegram rejects that with
 * "expected &lt;/b&gt;, found &lt;/a&gt;".
 */
export const captionEntitiesToHtml = (
  caption: string,
  entities: TelegramMessageEntity[] = [],
): string => {
  const text = String(caption ?? '');
  if (!text) return '';
  if (!entities.length) return escapeHtml(text);

  const usable: MappedEntity[] = [];
  for (let id = 0; id < entities.length; id++) {
    const ent = entities[id]!;
    const start = Math.max(0, Number(ent.offset) || 0);
    const end = Math.min(text.length, start + (Number(ent.length) || 0));
    if (end <= start) continue;
    if (!openEntityTag(ent, text.slice(start, end))) continue;
    usable.push({ id, ent, start, end, len: end - start });
  }

  if (!usable.length) return escapeHtml(text);

  const stack: MappedEntity[] = [];
  let html = '';

  const emitOpen = (item: MappedEntity) => {
    html += openEntityTag(item.ent, text.slice(item.start, item.end));
    stack.push(item);
  };

  const emitClose = (item: MappedEntity) => {
    html += closeEntityTag(item.ent);
  };

  /** Close until `target` is on top (temporarily closing nested tags), then close it. */
  const closeMapped = (target: MappedEntity) => {
    const reopen: MappedEntity[] = [];
    while (stack.length > 0) {
      const top = stack[stack.length - 1]!;
      if (top.id === target.id) {
        stack.pop();
        emitClose(top);
        break;
      }
      stack.pop();
      emitClose(top);
      // Only reopen ranges that still cover the current position.
      reopen.push(top);
    }
    for (let i = reopen.length - 1; i >= 0; i--) {
      const item = reopen[i]!;
      if (item.end > target.end) emitOpen(item);
    }
  };

  for (let i = 0; i <= text.length; i++) {
    const ending = usable
      .filter((u) => u.end === i)
      .sort((a, b) => a.len - b.len || b.id - a.id);
    for (const item of ending) {
      if (stack.some((s) => s.id === item.id)) closeMapped(item);
    }

    const starting = usable
      .filter((u) => u.start === i)
      .sort((a, b) => b.len - a.len || a.id - b.id);
    for (const item of starting) emitOpen(item);

    if (i < text.length) html += escapeHtml(text[i]!);
  }

  while (stack.length > 0) {
    emitClose(stack.pop()!);
  }

  return html;
};

/**
 * Fix nested / orphan &lt;tg-emoji&gt; tags (e.g. double-wrap from shared ❤️ fallbacks).
 */
export const repairTgEmojiHtml = (htmlCaption: string): string => {
  let out = String(htmlCaption ?? '');
  if (!out) return out;

  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out.replace(
      /<tg-emoji\b[^>]*>\s*(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)\s*<\/tg-emoji>/gi,
      '$1',
    );
  }

  // Drop orphan closing tags (keep balanced pairs only).
  const tokenRe = /<tg-emoji\b[^>]*>|<\/tg-emoji>/gi;
  let depth = 0;
  let rebuilt = '';
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = tokenRe.exec(out))) {
    rebuilt += out.slice(last, m.index);
    if (m[0].startsWith('</')) {
      if (depth > 0) {
        rebuilt += m[0];
        depth -= 1;
      }
    } else {
      rebuilt += m[0];
      depth += 1;
    }
    last = m.index + m[0].length;
  }
  rebuilt += out.slice(last);
  return rebuilt;
};

/**
 * Reorder crossed &lt;a&gt;/&lt;b&gt; closings Telegram rejects, e.g.
 * `&lt;a&gt;&lt;b&gt;x&lt;/a&gt;&lt;/b&gt;` → `&lt;a&gt;&lt;b&gt;x&lt;/b&gt;&lt;/a&gt;`.
 */
function uncrossAnchorBoldTags(html: string): string {
  let out = String(html ?? '');
  let prev = '';
  while (out !== prev) {
    prev = out;
    out = out
      .replace(
        /(<a\b[^>]*>)(\s*<b>)([\s\S]*?)<\/a>(\s*)<\/b>/gi,
        '$1$2$3</b>$4</a>',
      )
      .replace(
        /(<b>)(\s*<a\b[^>]*>)([\s\S]*?)<\/b>(\s*)<\/a>/gi,
        '$1$2$3</a>$4</b>',
      );
  }
  return out;
}

type HtmlToken =
  | { kind: 'text'; value: string }
  | { kind: 'open'; tag: string; raw: string }
  | { kind: 'close'; tag: string; raw: string };

function tokenizeSimpleHtml(html: string): HtmlToken[] {
  const src = String(html ?? '');
  const tokens: HtmlToken[] = [];
  const re = /<\/?(?:a|b|i|code)\b[^>]*>/gi;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src))) {
    if (m.index > last) {
      tokens.push({ kind: 'text', value: src.slice(last, m.index) });
    }
    const raw = m[0];
    const isClose = raw.startsWith('</');
    const tag = raw
      .replace(/^<\/?/, '')
      .replace(/[\s>/].*$/, '')
      .toLowerCase();
    tokens.push(
      isClose
        ? { kind: 'close', tag, raw: `</${tag}>` }
        : { kind: 'open', tag, raw },
    );
    last = m.index + raw.length;
  }
  if (last < src.length) tokens.push({ kind: 'text', value: src.slice(last) });
  return tokens;
}

/**
 * Stack-repair for a/b/i/code so closings always match the open top-of-stack.
 * Temporarily closes and reopens crossed parents (same idea as entity→HTML).
 * Runs outside &lt;tg-emoji&gt; blocks so premium markers stay intact.
 */
function stackRepairHtmlTags(html: string): string {
  const repairChunk = (chunk: string): string => {
    const tokens = tokenizeSimpleHtml(chunk);
    type Frame = { tag: string; openRaw: string };
    const stack: Frame[] = [];
    let out = '';

    for (const tok of tokens) {
      if (tok.kind === 'text') {
        out += tok.value;
        continue;
      }
      if (tok.kind === 'open') {
        stack.push({ tag: tok.tag, openRaw: tok.raw });
        out += tok.raw;
        continue;
      }

      const idx = stack.map((f) => f.tag).lastIndexOf(tok.tag);
      if (idx < 0) continue; // orphan close — drop

      const reopen: Frame[] = [];
      while (stack.length > idx + 1) {
        const top = stack.pop()!;
        out += `</${top.tag}>`;
        reopen.push(top);
      }
      stack.pop();
      out += `</${tok.tag}>`;
      for (let i = reopen.length - 1; i >= 0; i--) {
        const frame = reopen[i]!;
        stack.push(frame);
        out += frame.openRaw;
      }
    }

    while (stack.length > 0) {
      const top = stack.pop()!;
      out += `</${top.tag}>`;
    }

    return out;
  };

  return String(html ?? '')
    .split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/gi)
    .map((part) => (/^<tg-emoji\b/i.test(part) ? part : repairChunk(part)))
    .join('');
}

/** Balance &lt;a&gt;/&lt;b&gt; and tg-emoji tags so Telegram HTML parse_mode accepts the caption. */
export const repairHtmlCaption = (htmlCaption: string): string => {
  let out = repairTgEmojiHtml(htmlCaption);
  if (!out) return out;
  out = uncrossAnchorBoldTags(out);
  out = stackRepairHtmlTags(out);
  // Crossing repairs can leave empty reopened anchors.
  out = out.replace(/<a\b[^>]*>\s*<\/a>/gi, '');
  return repairTgEmojiHtml(out);
};

/**
 * Upgrade plain unicode schedule emojis to &lt;tg-emoji&gt; (for templates
 * bound before custom_emoji was preserved, or captions without entities).
 * Same glyph must only wrap once (heart + donation both use ❤️).
 */
export const upgradeKnownEmojisToPremiumHtml = (
  htmlCaption: string,
): string => {
  const src = repairTgEmojiHtml(htmlCaption);
  if (!src) return src;

  // Prefer donation over heart when both map to the same unicode.
  const priority: Record<string, number> = {
    donation: 0,
    heart: 1,
  };

  const seenFallback = new Set<string>();
  const entries = Object.entries(PREMIUM_EMOJI_FALLBACK)
    .map(([name, fallback]) => ({
      name,
      fallback,
      id: PREMIUM_EMOJI_IDS[name],
    }))
    .filter((e) => e.id && e.fallback)
    .sort(
      (a, b) =>
        (priority[a.name] ?? 50) - (priority[b.name] ?? 50) ||
        b.fallback.length - a.fallback.length,
    )
    .filter((e) => {
      if (seenFallback.has(e.fallback)) return false;
      seenFallback.add(e.fallback);
      return true;
    });

  const wrapOutsideTags = (chunk: string): string => {
    const parts = chunk.split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/g);
    return parts
      .map((part) => {
        if (part.startsWith('<tg-emoji')) return part;
        let out = part;
        for (const { fallback, id } of entries) {
          if (!out.includes(fallback)) continue;
          const tag = `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
          // Re-split after each wrap so the emoji inside the new tag is not wrapped again.
          out = out
            .split(/(<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>)/g)
            .map((sub) =>
              sub.startsWith('<tg-emoji') ? sub : sub.split(fallback).join(tag),
            )
            .join('');
        }
        return out;
      })
      .join('');
  };

  return repairTgEmojiHtml(wrapOutsideTags(src));
};

/**
 * Force the marker before season pack lines only:
 *   S01: Episode [01-12]  → pack / other-post link in the template footer
 * Does NOT touch per-episode lines (E05: [1080p][Softsub]) — those keep success/arrowDown.
 * Templates often reuse ✅ on the pack line, which would otherwise map to generic success.
 */
export const upgradeSeasonEpisodePackEmoji = (htmlCaption: string): string => {
  const src = String(htmlCaption ?? '');
  if (!src) return src;
  const id = PREMIUM_EMOJI_IDS.seasonEpisode;
  const fallback = PREMIUM_EMOJI_FALLBACK.seasonEpisode;
  if (!id || !fallback) return src;
  const tag = `<tg-emoji emoji-id="${id}">${fallback}</tg-emoji>`;
  // Require Episode [range] so E## single-episode lines never match.
  const packRe = /S\d{2}:\s*Episode\s*\[/i;

  return src
    .split('\n')
    .map((line) => {
      if (!packRe.test(line)) return line;
      // Prefer an existing <tg-emoji>…</tg-emoji> immediately before S##:; else a plain glyph.
      const withMarker = line.replace(
        /(?:<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>|[^\s<>]+)\s*(?=S\d{2}:\s*Episode\s*\[)/i,
        `${tag} `,
      );
      if (withMarker !== line) return withMarker;
      // No marker — insert the season-episode emoji before S##:
      return line.replace(/(?=S\d{2}:\s*Episode\s*\[)/i, `${tag} `);
    })
    .join('\n');
};

/** Always Softsub in channel post template (panel media type is ignored). */
const videoLabel = () => '[1080p][Softsub]';

/**
 * New / updated episode line:
 * ⬇️ <b>E05</b>: <a>[1080p Softsub]</a> | <a>Subtitle</a>
 * Subtitle segment omitted when subtitleUrl is empty.
 * Older episodes use green check (✅); the focused/new episode uses arrowDown.
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
    opts.isNew === false ? premiumEmoji('success') : premiumEmoji('arrowDown');
  const video = tgLink(opts.videoUrl, videoLabel());
  if (opts.subtitleUrl?.trim()) {
    return `${marker} <b>E${epLabel}</b>: ${video} | ${tgLink(opts.subtitleUrl.trim(), 'Subtitle')}`;
  }
  return `${marker} <b>E${epLabel}</b>: ${video}`;
};

/** Telegram photo / media caption limit (UTF-16 length of parsed text). */
export const TELEGRAM_PHOTO_CAPTION_MAX = 1024;

/**
 * Approximate plain-text length Telegram will count for an HTML caption
 * (tags stripped; entities decoded; BMP UTF-16 ≈ JS string length).
 */
export const telegramHtmlCaptionPlainLength = (htmlCaption: string): number => {
  let plain = String(htmlCaption ?? '');
  if (!plain) return 0;
  plain = plain
    .replace(/<tg-emoji\b[^>]*>([\s\S]*?)<\/tg-emoji>/gi, '$1')
    .replace(/<\/?(?:a|b|i|code|u|s|pre|span)\b[^>]*>/gi, '')
    .replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => {
      const code = Number(n);
      return Number.isFinite(code) ? String.fromCodePoint(code) : '';
    });
  return plain.length;
};

export const isCaptionWithinPhotoBudget = (
  htmlCaption: string,
  max = TELEGRAM_PHOTO_CAPTION_MAX,
): boolean => telegramHtmlCaptionPlainLength(htmlCaption) <= max;

/**
 * Highest episode end covered by **cour pack** lines like:
 *   P01: Episode [01-12]
 *
 * Only `P##` counts — those mean "earlier episodes of this season's numbering
 * are already in a previous post". `S##: Episode […]` is a previous-season
 * link and must NOT skip E01/E02 of the current season (e.g. Ao Ashi S2 with
 * `S01: Episode [01-24]` still needs E01+E02 listed).
 *
 * Works with HTML wrappers / text_link around the range.
 * Returns 0 when no P-pack line is present (build from E01).
 */
export const getMaxPackedEpisodeEnd = (captionHtml: string): number => {
  const raw = String(captionHtml ?? '');
  if (!raw) return 0;

  // Strip tags so <b>P01</b>: Episode <a>[01-12]</a> still matches.
  const plain = raw.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  const re = /P\d{2}\s*:\s*Episode\s*\[(\d+)\s*[-–—]\s*(\d+)\]/gi;
  let maxEnd = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(plain))) {
    const end = Number(m[2]);
    if (Number.isFinite(end) && end > maxEnd) maxEnd = end;
  }
  return maxEnd;
};

/** True for per-episode lines like "… E05: …", not season packs ("Episode [01-12]"). */
export const isEpisodeCaptionLine = (line: string): boolean => {
  const raw = String(line ?? '');
  if (/\bEpisode\b/i.test(raw)) return false;
  return /(?:^|>)\s*E\d{2}\b/i.test(raw) || /<b>\s*E\d{2}\s*<\/b>/i.test(raw);
};

export const extractEpisodeNumberFromCaptionLine = (
  line: string,
): number | null => {
  const m = String(line ?? '').match(/E(\d{2})\b/i);
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isFinite(n) ? n : null;
};

/**
 * Replace the episode-line block in a caption with a full rebuilt list.
 * Keeps header / season-pack / footer lines intact.
 */
export const replaceEpisodeLinesInCaption = (
  captionHtml: string,
  episodeLines: string[],
): string => {
  const raw = String(captionHtml ?? '').trimEnd();
  if (!episodeLines.length) return raw;
  if (!raw) return episodeLines.join('\n');

  const lines = raw.split(/\n/);
  const epIndexes: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (isEpisodeCaptionLine(lines[i] ?? '')) epIndexes.push(i);
  }

  if (epIndexes.length === 0) {
    const footerRe = /(Donation|Synopsis|#|@TheShioriSub)/i;
    const footerIndex = lines.findIndex((l) => footerRe.test(l));
    if (footerIndex > 0) {
      const insertAt =
        lines[footerIndex - 1]?.trim() === '' ? footerIndex - 1 : footerIndex;
      lines.splice(insertAt, 0, ...episodeLines, '');
      return lines.join('\n');
    }
    return `${raw}\n${episodeLines.join('\n')}`;
  }

  const first = epIndexes[0]!;
  const last = epIndexes[epIndexes.length - 1]!;
  const before = lines.slice(0, first);
  const after = lines.slice(last + 1);
  return [...before, ...episodeLines, ...after].join('\n');
};

/**
 * Insert (or replace) an episode line in an existing HTML caption.
 * Places the new line after the last E## line when possible.
 * Prefer {@link replaceEpisodeLinesInCaption} when syncing from catalog.
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
  const thisEpRe = new RegExp(`E${epLabel}\\b`, 'i');

  let lastEpIndex = -1;
  let thisEpIndex = -1;
  for (let i = 0; i < lines.length; i++) {
    if (isEpisodeCaptionLine(lines[i] ?? '')) lastEpIndex = i;
    if (thisEpRe.test(lines[i] ?? '') && isEpisodeCaptionLine(lines[i] ?? '')) {
      thisEpIndex = i;
    }
  }

  // Mark earlier episode lines as checked when inserting/updating a newer one.
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? '';
    if (!isEpisodeCaptionLine(line)) continue;
    const n = extractEpisodeNumberFromCaptionLine(line);
    if (n == null || n >= episodeNumber) continue;
    lines[i] = line.replace(
      /^(?:<tg-emoji\b[^>]*>[\s\S]*?<\/tg-emoji>\s*)+/,
      `${premiumEmoji('success')} `,
    );
    // Plain unicode / leftover markers before E##
    if (!lines[i]!.startsWith('<tg-emoji')) {
      lines[i] = lines[i]!.replace(
        /^[^\s<]*\s*(?=(?:<b>)?E\d{2}\b)/i,
        `${premiumEmoji('success')} `,
      );
    }
  }

  if (thisEpIndex >= 0) {
    lines[thisEpIndex] = episodeLine;
    return lines.join('\n');
  }

  if (lastEpIndex >= 0) {
    lines.splice(lastEpIndex + 1, 0, episodeLine);
    return lines.join('\n');
  }

  const footerRe = /(Donation|Synopsis|#)/i;
  const footerIndex = lines.findIndex((l) => footerRe.test(l));
  if (footerIndex > 0) {
    const insertAt =
      lines[footerIndex - 1]?.trim() === '' ? footerIndex - 1 : footerIndex;
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

/** Episodes 1–3 keep bot file links; from 4 onward caption links open the mini-app episodes tab. */
export const CHANNEL_DRAFT_MINI_APP_LINK_FROM_EPISODE = 4;

export const channelDraftEpisodeLinkUrls = (opts: {
  episodeNumber: number;
  botVideoUrl: string;
  botSubtitleUrl?: string | null;
  miniAppEpisodesUrl: string;
}): { videoUrl: string; subtitleUrl?: string | null } => {
  const n = Number(opts.episodeNumber);
  if (!Number.isFinite(n) || n < CHANNEL_DRAFT_MINI_APP_LINK_FROM_EPISODE) {
    return {
      videoUrl: opts.botVideoUrl,
      subtitleUrl: opts.botSubtitleUrl,
    };
  }
  const mini = String(opts.miniAppEpisodesUrl ?? '').trim();
  return {
    videoUrl: mini || opts.botVideoUrl,
    subtitleUrl: mini || opts.botSubtitleUrl,
  };
};
