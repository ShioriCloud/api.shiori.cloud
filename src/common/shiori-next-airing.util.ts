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

/** Most recent weekly slot that has already started (next occurrence minus 7 days). */
export function lastTehranOccurrenceUnixSec(
  weekday: string,
  hour: number,
  minute: number,
  nowMs = Date.now(),
): number | null {
  const next = nextTehranOccurrenceUnixSec(weekday, hour, minute, nowMs);
  if (next == null) return null;
  const parts = getTehranDateParts(next * 1000);
  if (!parts) return null;
  const prev = addUtcCalendarDays(parts.year, parts.month, parts.day, -7);
  const utcMs = tehranWallTimeToUtcMs(
    prev.year,
    prev.month,
    prev.day,
    hour,
    minute,
  );
  if (utcMs == null) return null;
  return Math.floor(utcMs / 1000);
}

export function parseIsoDateYmd(
  value: string | null | undefined,
): { year: number; month: number; day: number } | null {
  const match = String(value ?? '')
    .trim()
    .match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (!Number.isFinite(year) || month < 1 || month > 12 || day < 1 || day > 31) {
    return null;
  }
  return { year, month, day };
}

export function tehranDateHhmmToUnixSec(
  dateYmd: string,
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

export function persianWeekdayFromUnixSec(unixSec: number): ShioriWeekday | '' {
  const weekday = persianWeekdayInTehran(unixSec * 1000);
  return (SHIORI_WEEKDAYS as readonly string[]).includes(weekday)
    ? (weekday as ShioriWeekday)
    : '';
}

export type ShioriAiringPlan = NextAiringDto & {
  weekday: ShioriWeekday;
};

/** Treat an upload up to 12h before the slot as covering that slot. */
const SLOT_COVER_GRACE_MS = 12 * 60 * 60 * 1000;

function toEpochMs(value: Date | string | number | null | undefined): number | null {
  if (value == null || value === '') return null;
  if (value instanceof Date) {
    const ms = value.getTime();
    return Number.isFinite(ms) ? ms : null;
  }
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return null;
    return value < 1e12 ? value * 1000 : value;
  }
  const ms = Date.parse(String(value));
  return Number.isFinite(ms) ? ms : null;
}

export function resolveShioriAiringPlan(
  input: {
    airingStatus?: string | null;
    airingWeekday?: string | null;
    airingTime?: string | null;
    nextAiringDate?: string | null;
    maxPublishedEpisode?: number | null;
    lastPublishedAt?: Date | string | number | null;
  },
  nowMs = Date.now(),
): ShioriAiringPlan | null {
  const status = String(input.airingStatus ?? '')
    .trim()
    .toUpperCase();
  if (status !== 'RELEASING') return null;

  const time = parseAiringTimeHhmm(input.airingTime);
  if (!time) return null;

  const maxEp = Number(input.maxPublishedEpisode);
  const episode =
    Number.isFinite(maxEp) && maxEp > 0 ? Math.floor(maxEp) + 1 : 1;
  const hasPublished = Number.isFinite(maxEp) && maxEp > 0;
  const lastPublishedMs = toEpochMs(input.lastPublishedAt);

  const overrideAt = tehranDateHhmmToUnixSec(
    String(input.nextAiringDate ?? ''),
    time.hour,
    time.minute,
  );
  if (overrideAt != null && overrideAt * 1000 > nowMs) {
    const weekday = persianWeekdayFromUnixSec(overrideAt);
    if (!weekday) return null;
    return { episode, airing_at: overrideAt, weekday };
  }

  const weekday = String(input.airingWeekday ?? '').trim();
  if (!(SHIORI_WEEKDAYS as readonly string[]).includes(weekday)) return null;

  const airingAt = nextTehranOccurrenceUnixSec(
    weekday,
    time.hour,
    time.minute,
    nowMs,
  );
  if (airingAt == null || airingAt <= 0) return null;

  if (hasPublished) {
    const lastSlot = lastTehranOccurrenceUnixSec(
      weekday,
      time.hour,
      time.minute,
      nowMs,
    );
    if (lastSlot != null) {
      const coverAfter = lastSlot * 1000 - SLOT_COVER_GRACE_MS;
      const covered =
        lastPublishedMs != null && lastPublishedMs >= coverAfter;
      if (!covered) return null;
    }
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
