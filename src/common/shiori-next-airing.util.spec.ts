import {
  nextTehranOccurrenceUnixSec,
  parseAiringTimeHhmm,
  parseIsoDateYmd,
  resolveEpisode1UnixSec,
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

describe('parseIsoDateYmd', () => {
  it('keeps pg-style UTC midnight dates', () => {
    expect(parseIsoDateYmd(new Date(Date.UTC(2026, 8, 12)))).toEqual({
      year: 2026,
      month: 9,
      day: 12,
    });
  });

  it('does not shift Asia/Tehran local midnight back a day', () => {
    // Local midnight on 2026-09-12 in Iran (+03:30) is still civil day 12.
    const localMidnight = new Date(2026, 8, 12, 0, 0, 0, 0);
    expect(parseIsoDateYmd(localMidnight)).toEqual({
      year: 2026,
      month: 9,
      day: 12,
    });
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

describe('resolveEpisode1UnixSec', () => {
  it('uses start_date when it already matches the weekday', () => {
    // 2026-09-12 is Saturday
    const unix = resolveEpisode1UnixSec('2026-09-12', 'شنبه', 22, 0);
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Sat', time: '22:00' });
  });

  it('aligns forward to the next matching weekday', () => {
    // 2026-09-13 is Sunday → next شنبه is 2026-09-19
    const unix = resolveEpisode1UnixSec('2026-09-13', 'شنبه', 22, 0);
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Sat', time: '22:00' });
    expect(unix).toBe(Math.floor(Date.UTC(2026, 8, 19, 18, 30) / 1000));
  });

  it('accepts local Date objects without off-by-one', () => {
    const unix = resolveEpisode1UnixSec(new Date(2026, 8, 12), 'شنبه', 22, 0);
    expect(unix).not.toBeNull();
    expect(formatTehran(unix!)).toEqual({ weekday: 'Sat', time: '22:00' });
  });
});

describe('resolveShioriNextAiring', () => {
  it('returns null unless RELEASING or NOT_YET_RELEASED with a valid slot', () => {
    expect(
      resolveShioriNextAiring({
        airingStatus: 'FINISHED',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
      }),
    ).toBeNull();
    expect(
      resolveShioriNextAiring({
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: null,
        startDate: '2026-09-12',
      }),
    ).toBeNull();
  });

  it('includes upcoming NOT_YET_RELEASED titles on the weekly board', () => {
    const beforePremiere = Date.UTC(2026, 8, 10, 6, 30); // 2026-09-10 Tehran morning
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'NOT_YET_RELEASED',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 12,
        maxPublishedEpisode: 0,
      },
      beforePremiere,
    );
    expect(result?.episode).toBe(1);
    expect(formatTehran(result!.airing_at)).toEqual({
      weekday: 'Sat',
      time: '22:00',
    });
  });

  it('advances episode by calendar weeks from start_date, not uploads', () => {
    // Ep1: 2026-09-12 22:00 Tehran. Four weeks later morning → next is ep 5.
    const fourWeeksLaterMorning = Date.UTC(2026, 9, 10, 6, 30); // 2026-10-10 10:00 Tehran
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 12,
        maxPublishedEpisode: 2, // uploads lag behind — calendar still wins
      },
      fourWeeksLaterMorning,
    );
    expect(result?.episode).toBe(5);
    expect(formatTehran(result!.airing_at)).toEqual({
      weekday: 'Sat',
      time: '22:00',
    });
  });

  it('floors next episode at max published + 1 when calendar is behind', () => {
    // Only one week after premiere → calendar says ep 2, but ep 4 is already up.
    const oneWeekLaterMorning = Date.UTC(2026, 8, 19, 6, 30);
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 12,
        maxPublishedEpisode: 4,
      },
      oneWeekLaterMorning,
    );
    expect(result?.episode).toBe(5);
  });

  it('shows episode 1 before the premiere slot', () => {
    const fridayBefore = Date.UTC(2026, 8, 11, 6, 30); // 2026-09-11 10:00 Tehran
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 12,
      },
      fridayBefore,
    );
    expect(result?.episode).toBe(1);
    expect(formatTehran(result!.airing_at)).toEqual({
      weekday: 'Sat',
      time: '22:00',
    });
  });

  it('hides once all planned episodes have aired', () => {
    // After ep12 slot (12 weeks after 2026-09-12)
    const afterFinale = Date.UTC(2026, 11, 5, 19, 0); // well after finale
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 12,
      },
      afterFinale,
    );
    expect(result).toBeNull();
  });

  it('respects a custom episodes_count shorter than 12', () => {
    // After ep 3 of a 3-ep series
    const afterShortRun = Date.UTC(2026, 8, 27, 6, 30); // ~2 weeks later Sunday
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        episodesCount: 3,
      },
      afterShortRun,
    );
    // Ep3 was 2026-09-26 22:00; by Sep 27 morning all done
    expect(result).toBeNull();
  });

  it('defaults episodes_count to 12 when unset', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(1);
  });

  it('uses a future manual date instead of the next calendar slot', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        nextAiringDate: '2026-09-26',
        episodesCount: 12,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(1);
    expect(result?.airing_at).toBe(
      Math.floor(Date.UTC(2026, 8, 26, 18, 30) / 1000),
    );
  });

  it('keeps the delayed episode when next_airing_date is set after the slot passed', () => {
    // Ep1 Sat 09-12, ep2 Sat 09-19. Sunday after ep2 slot → calendar would say ep3,
    // but only ep1 is published and override pins the delayed ep2.
    const sundayAfterEp2 = Date.UTC(2026, 8, 20, 6, 30);
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        startDate: '2026-09-12',
        nextAiringDate: '2026-09-26',
        episodesCount: 12,
        maxPublishedEpisode: 1,
      },
      sundayAfterEp2,
    );
    expect(result?.episode).toBe(2);
    expect(result?.airing_at).toBe(
      Math.floor(Date.UTC(2026, 8, 26, 18, 30) / 1000),
    );
  });

  it('falls back to upload-based episode when start_date is missing', () => {
    const result = resolveShioriNextAiring(
      {
        airingStatus: 'RELEASING',
        airingWeekday: 'شنبه',
        airingTime: '22:00',
        maxPublishedEpisode: 5,
        episodesCount: 12,
      },
      SAT_MORNING_TEHRAN_MS,
    );
    expect(result?.episode).toBe(6);
  });
});
