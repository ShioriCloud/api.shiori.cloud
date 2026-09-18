/** Persian weekday labels used by admin slots and the mini-app schedule. */
export const SHIORI_WEEKDAYS = [
  'شنبه',
  'یکشنبه',
  'دوشنبه',
  'سه‌شنبه',
  'چهارشنبه',
  'پنج‌شنبه',
  'جمعه',
] as const;

export type ShioriWeekday = (typeof SHIORI_WEEKDAYS)[number];

/** Mini-app catalog detail field: unix seconds (AniList `airingAt` convention). */
export type NextAiringDto = {
  episode: number;
  airing_at: number;
};

const TEHRAN_TZ = 'Asia/Tehran';
const WEEK_SEC = 7 * 24 * 60 * 60;
/** Admin default when episodes_count is empty. */
export const DEFAULT_EPISODES_COUNT = 12;

const EN_WEEKDAY_TO_FA: Record<string, ShioriWeekday> = {
  Sun: 'یکشنبه',
  Mon: 'دوشنبه',
  Tue: 'سه‌شنبه',
  Wed: 'چهارشنبه',
  Thu: 'پنج‌شنبه',
  Fri: 'جمعه',
  Sat: 'شنبه',
};

export function parseAiringTimeHhmm(
  value: string | null | undefined,
): { hour: number; minute: number } | null {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/**
 * Next weekly occurrence of weekday + HH:mm in Asia/Tehran, as unix seconds.
 * If today's slot has already started, returns next week.
 */
export function nextTehranOccurrenceUnixSec(
  weekday: string,
  hour: number,
  minute: number,
  nowMs = Date.now(),
): number | null {
  const targetIndex = (SHIORI_WEEKDAYS as readonly string[]).indexOf(weekday);
  if (targetIndex < 0) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  const nowParts = getTehranDateParts(nowMs);
  if (!nowParts) return null;

  const currentWeekday = persianWeekdayInTehran(nowMs);
  const currentIndex = (SHIORI_WEEKDAYS as readonly string[]).indexOf(
    currentWeekday,
  );
  if (currentIndex < 0) return null;

  let daysAhead = (targetIndex - currentIndex + 7) % 7;
  if (daysAhead === 0) {
    const nowMinutes = nowParts.hour * 60 + nowParts.minute;
    if (nowMinutes >= hour * 60 + minute) daysAhead = 7;
  }

  const target = addUtcCalendarDays(
    nowParts.year,
    nowParts.month,
    nowParts.day,
    daysAhead,
  );
  const utcMs = tehranWallTimeToUtcMs(
    target.year,
    target.month,
    target.day,
    hour,
    minute,
  );
  if (utcMs == null) return null;
  return Math.floor(utcMs / 1000);
}

export function parseIsoDateYmd(
  value: string | null | undefined | Date,
): { year: number; month: number; day: number } | null {
  let raw = '';
  if (value instanceof Date && Number.isFinite(value.getTime())) {
    raw = value.toISOString().slice(0, 10);
  } else {
    raw = String(value ?? '').trim();
  }
  const match = raw.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

function formatYmd(year: number, month: number, day: number): string {
  const p = (n: number) => String(n).padStart(2, '0');
  return `${year}-${p(month)}-${p(day)}`;
}

export function tehranDateHhmmToUnixSec(
  dateYmd: string | Date | null | undefined,
  hour: number,
  minute: number,
): number | null {
  const date = parseIsoDateYmd(dateYmd);
  if (!date) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  const utcMs = tehranWallTimeToUtcMs(
    date.year,
    date.month,
    date.day,
    hour,
    minute,
  );
  if (utcMs == null) return null;
  return Math.floor(utcMs / 1000);
}

/**
 * First weekly slot on/after startDate at HH:mm (Tehran).
 * Aligns startDate forward up to 6 days when it is not already on `weekday`.
 */
export function resolveEpisode1UnixSec(
  startDateYmd: string | Date | null | undefined,
  weekday: string,
  hour: number,
  minute: number,
): number | null {
  const start = parseIsoDateYmd(startDateYmd);
  if (!start) return null;
  if (!(SHIORI_WEEKDAYS as readonly string[]).includes(weekday)) return null;
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;

  for (let add = 0; add < 7; add++) {
    const d = addUtcCalendarDays(start.year, start.month, start.day, add);
    const noonUtc = tehranWallTimeToUtcMs(d.year, d.month, d.day, 12, 0);
    if (noonUtc == null) continue;
    if (persianWeekdayInTehran(noonUtc) !== weekday) continue;
    return tehranDateHhmmToUnixSec(formatYmd(d.year, d.month, d.day), hour, minute);
  }
  return null;
}

export function persianWeekdayFromUnixSec(unixSec: number): ShioriWeekday | '' {
  const weekday = persianWeekdayInTehran(unixSec * 1000);
  return (SHIORI_WEEKDAYS as readonly string[]).includes(weekday)
    ? (weekday as ShioriWeekday)
    : '';
}

export type ShioriAiringPlan = NextAiringDto & {
  weekday: ShioriWeekday;
};

function normalizeEpisodesCount(value: number | null | undefined): number {
  const n = Number(value);
  if (Number.isFinite(n) && n > 0) return Math.floor(n);
  return DEFAULT_EPISODES_COUNT;
}

/**
 * Weekly schedule progression from catalog start_date + weekday/time + episodes_count.
 * Independent of whether episodes have been uploaded yet.
 */
export function resolveShioriAiringPlan(
  input: {
    airingStatus?: string | null;
    airingWeekday?: string | null;
    airingTime?: string | null;
    nextAiringDate?: string | null;
    /** Series premiere date (YYYY-MM-DD, Tehran calendar day). */
    startDate?: string | Date | null;
    /** Catalog total; defaults to 12 when empty. */
    episodesCount?: number | null;
    /**
     * Legacy fallback only when startDate is missing:
     * next episode ≈ max published + 1.
     */
    maxPublishedEpisode?: number | null;
  },
  nowMs = Date.now(),
): ShioriAiringPlan | null {
  const status = String(input.airingStatus ?? '')
    .trim()
    .toUpperCase();
  if (status !== 'RELEASING') return null;

  const time = parseAiringTimeHhmm(input.airingTime);
  if (!time) return null;

  const weekday = String(input.airingWeekday ?? '').trim();
  if (!(SHIORI_WEEKDAYS as readonly string[]).includes(weekday)) return null;

  const total = normalizeEpisodesCount(input.episodesCount);
  const nowSec = Math.floor(nowMs / 1000);

  const ep1At = resolveEpisode1UnixSec(
    input.startDate,
    weekday,
    time.hour,
    time.minute,
  );

  let episode: number;
  let airingAt: number;

  if (ep1At != null) {
    // Calendar: ep N airs at ep1 + (N-1) weeks. Pick the next future slot.
    let nextEp: number | null = null;
    let nextAt: number | null = null;
    for (let n = 1; n <= total; n++) {
      const at = ep1At + (n - 1) * WEEK_SEC;
      if (at > nowSec) {
        nextEp = n;
        nextAt = at;
        break;
      }
    }
    if (nextEp == null || nextAt == null) return null;
    episode = nextEp;
    airingAt = nextAt;
  } else {
    // No start_date yet — keep a simple next weekly slot (legacy).
    const maxEp = Number(input.maxPublishedEpisode);
    const published =
      Number.isFinite(maxEp) && maxEp > 0 ? Math.floor(maxEp) : 0;
    if (published >= total) return null;
    episode = published > 0 ? published + 1 : 1;
    const nextAt = nextTehranOccurrenceUnixSec(
      weekday,
      time.hour,
      time.minute,
      nowMs,
    );
    if (nextAt == null || nextAt <= 0) return null;
    airingAt = nextAt;
  }

  const overrideAt = tehranDateHhmmToUnixSec(
    String(input.nextAiringDate ?? ''),
    time.hour,
    time.minute,
  );
  if (overrideAt != null && overrideAt > nowSec) {
    const overrideWeekday = persianWeekdayFromUnixSec(overrideAt);
    if (!overrideWeekday) return null;
    return { episode, airing_at: overrideAt, weekday: overrideWeekday };
  }

  return {
    episode,
    airing_at: airingAt,
    weekday: weekday as ShioriWeekday,
  };
}

export function resolveShioriNextAiring(
  input: Parameters<typeof resolveShioriAiringPlan>[0],
  nowMs = Date.now(),
): NextAiringDto | null {
  const plan = resolveShioriAiringPlan(input, nowMs);
  if (!plan) return null;
  return { episode: plan.episode, airing_at: plan.airing_at };
}

function persianWeekdayInTehran(nowMs: number): string {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    weekday: 'short',
  }).format(new Date(nowMs));
  return EN_WEEKDAY_TO_FA[weekday] ?? '';
}

function getTehranDateParts(nowMs: number): {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
} | null {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TEHRAN_TZ,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    hourCycle: 'h23',
  }).formatToParts(new Date(nowMs));
  const num = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((p) => p.type === type)?.value);
  const year = num('year');
  const month = num('month');
  const day = num('day');
  let hour = num('hour');
  const minute = num('minute');
  if (![year, month, day, hour, minute].every(Number.isFinite)) return null;
  if (hour === 24) hour = 0;
  return { year, month, day, hour, minute };
}

function addUtcCalendarDays(
  year: number,
  month: number,
  day: number,
  days: number,
): { year: number; month: number; day: number } {
  const utc = new Date(Date.UTC(year, month - 1, day + days));
  return {
    year: utc.getUTCFullYear(),
    month: utc.getUTCMonth() + 1,
    day: utc.getUTCDate(),
  };
}

/** Invert Asia/Tehran wall clock → UTC without hardcoding +03:30. */
function tehranWallTimeToUtcMs(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
): number | null {
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const shown = getTehranDateParts(utcGuess);
  if (!shown) return null;
  const shownAsUtc = Date.UTC(
    shown.year,
    shown.month - 1,
    shown.day,
    shown.hour,
    shown.minute,
    0,
  );
  return utcGuess - (shownAsUtc - utcGuess);
}
