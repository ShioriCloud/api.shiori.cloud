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

export function resolveShioriNextAiring(input: {
  airingStatus?: string | null;
  airingWeekday?: string | null;
  airingTime?: string | null;
  maxPublishedEpisode?: number | null;
}): NextAiringDto | null {
  const status = String(input.airingStatus ?? '')
    .trim()
    .toUpperCase();
  if (status !== 'RELEASING') return null;

  const weekday = String(input.airingWeekday ?? '').trim();
  const time = parseAiringTimeHhmm(input.airingTime);
  if (!time) return null;

  const airingAt = nextTehranOccurrenceUnixSec(weekday, time.hour, time.minute);
  if (airingAt == null || airingAt <= 0) return null;

  const maxEp = Number(input.maxPublishedEpisode);
  const episode =
    Number.isFinite(maxEp) && maxEp > 0 ? Math.floor(maxEp) + 1 : 1;

  return { episode, airing_at: airingAt };
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
