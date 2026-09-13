import {
  interpretAnilistScoreJson,
  interpretJikanScoreJson,
  parseExternalScore,
} from './external-score.util';

describe('parseExternalScore', () => {
  it('rejects null and zero', () => {
    expect(parseExternalScore(null)).toBeNull();
    expect(parseExternalScore(0)).toBeNull();
    expect(parseExternalScore('0')).toBeNull();
  });

  it('keeps a real AniList percent', () => {
    expect(parseExternalScore(84)).toBe(84);
    expect(parseExternalScore(8.4)).toBe(8.4);
  });
});

describe('interpretAnilistScoreJson', () => {
  it('treats a missing rating as a skip, not an error', () => {
    expect(
      interpretAnilistScoreJson({
        data: { Media: { averageScore: null, meanScore: null } },
      }),
    ).toEqual({ score: null, skipped: true, skipReason: 'no_score_yet' });
  });

  it('treats a zero rating as no score yet', () => {
    expect(
      interpretAnilistScoreJson({
        data: { Media: { averageScore: 0, meanScore: 0 } },
      }),
    ).toEqual({ score: null, skipped: true, skipReason: 'no_score_yet' });
  });

  it('prefers averageScore when present', () => {
    expect(
      interpretAnilistScoreJson({
        data: { Media: { averageScore: 79, meanScore: 81 } },
      }),
    ).toEqual({ score: 79 });
  });

  it('falls back to meanScore', () => {
    expect(
      interpretAnilistScoreJson({
        data: { Media: { averageScore: null, meanScore: 81 } },
      }),
    ).toEqual({ score: 81 });
  });

  it('skips Not Found instead of failing the sync', () => {
    expect(
      interpretAnilistScoreJson({
        data: { Media: null },
        errors: [{ message: 'Not Found.', status: 404 }],
      }),
    ).toEqual({ score: null, skipped: true, skipReason: 'not_found' });
  });

  it('does not crash on an empty body', () => {
    expect(interpretAnilistScoreJson(null)).toEqual({
      score: null,
      error: 'AniList empty response',
    });
  });
});

describe('interpretJikanScoreJson', () => {
  it('skips a 404 so MAL cannot fail the whole request', () => {
    expect(interpretJikanScoreJson(null, 404)).toEqual({
      score: null,
      skipped: true,
      skipReason: 'not_found',
    });
  });

  it('skips when Jikan has the title but no score yet', () => {
    expect(interpretJikanScoreJson({ data: { score: null } }, 200)).toEqual({
      score: null,
      skipped: true,
      skipReason: 'no_score_yet',
    });
  });

  it('reads a MAL score', () => {
    expect(interpretJikanScoreJson({ data: { score: 8.42 } }, 200)).toEqual({
      score: 8.42,
    });
  });
});
