import {
  nextTehranOccurrenceUnixSec,
  parseAiringTimeHhmm,
  resolveShioriNextAiring,
} from './shiori-next-airing.util';

const formatTehran = (unixSec: number) => {
  const d = new Date(unixSec * 1000);
  return {
    weekday: new Intl.DateTimeFormat('en-US', {
      timeZone: 'Asia/Tehran',
      weekday: 'short',
    }).format(d),
    time: new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Asia/Tehran',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).format(d),
  };
};

/** Saturday 2026-09-12 10:00 Asia/Tehran */
const SAT_MORNING_TEHRAN_MS = Date.UTC(2026, 8, 12, 6, 30);

describe('parseAiringTimeHhmm', () => {
  it('accepts admin HH:mm', () => {
    expect(parseAiringTimeHhmm('22:00')).toEqual({ hour: 22, minute: 0 });
    expect(parseAiringTimeHhmm('9:05')).toEqual({ hour: 9, minute: 5 });
  });

  it('rejects invalid values', () => {
    expect(parseAiringTimeHhmm('')).toBeNull();
    expect(parseAiringTimeHhmm('25:00')).toBeNull();
    expect(parseAiringTimeHhmm('22:00:00')).toBeNull();
  });
});

describe('nextTehranOccurrenceUnixSec', () => {
  it('uses today when the slot is still ahead', () => {
    const unix = nextTehranOccurrenceUnixSec(
      'شنبه',
      22,
      0,
      SAT_MORNING_TEHRAN_MS,
    );
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Sat', time: '22:00' });
    expect(unix! * 1000).toBeGreaterThan(SAT_MORNING_TEHRAN_MS);
    expect(unix! * 1000 - SAT_MORNING_TEHRAN_MS).toBeLessThan(24 * 3600 * 1000);
  });

  it('rolls to next week after the slot has started', () => {
    const satNight = Date.UTC(2026, 8, 12, 19, 0); // 22:30 Tehran
    const unix = nextTehranOccurrenceUnixSec('شنبه', 22, 0, satNight);
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Sat', time: '22:00' });
    expect(unix! * 1000 - satNight).toBeGreaterThan(6 * 24 * 3600 * 1000);
  });

  it('jumps forward to mid-week slot', () => {
    const unix = nextTehranOccurrenceUnixSec(
      'سه‌شنبه',
      14,
      30,
      SAT_MORNING_TEHRAN_MS,
    );
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Tue', time: '14:30' });
  });
});

describe('resolveShioriNextAiring', () => {
  it('returns null unless RELEASING with a valid slot', () => {
    expect(
      resolveShioriNextAiring({
        airingStatus: 'FINISHED',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 3,
      }),
    ).toBeNull();
    expect(
      resolveShioriNextAiring({
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: null,
      }),
    ).toBeNull();
  });

  it('hints next episode as max published + 1', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 5,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(6);
    expect(result?.airing_at).toBeGreaterThan(0);
  });

  it('defaults episode to 1 when none are published', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'releasing',
        airingWeekday: 'جمعه',
        airingTime: '00:00',
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(1);
  });

  it('keeps the next weekly slot even when the last upload is late', () => {
    const sundayMorning = Date.UTC(2026, 8, 13, 6, 30); // 10:00 Tehran
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 4,
        episodesCount: 12,
      },
      sundayMorning,
    );
    expect(result?.episode).toBe(5);
    expect(result?.airing_at).toBeGreaterThan(sundayMorning / 1000);
    expect(formatTehran(result!.airing_at)).toEqual({
      weekday: 'Sat',
      time: '22:00',
    });
  });

  it('hides from the schedule once all catalog episodes are out', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 12,
        episodesCount: 12,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result).toBeNull();
  });

  it('still shows when episodes_count is unknown', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 20,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(21);
  });

  it('uses a future manual date instead of the next weekly slot', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        nextAiringDate: '2026-09-26',
        maxPublishedEpisode: 4,
        episodesCount: 12,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.airing_at).toBe(
      Math.floor(Date.UTC(2026, 8, 26, 18, 30) / 1000),
    );
  });
});
