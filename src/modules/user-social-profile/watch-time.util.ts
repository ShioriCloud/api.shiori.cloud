/** Default length for episodic titles (TV / ONA / OVA / special / …). */
export const EPISODE_MINUTES = 24;
/** Assumed average length for movie entries. */
export const MOVIE_MINUTES = 90;

export type ProfileFormatBucket =
  | 'TV'
  | 'MOVIE'
  | 'SPECIAL'
  | 'DONGHUA'
  | 'MUSIC'
  | 'OTHER';

export const normalizeProfileFormat = (
  raw: string | null | undefined,
): ProfileFormatBucket => {
  const key = String(raw ?? '')
    .trim()
    .toUpperCase()
    .replace(/\s+/g, ' ');
  if (!key) return 'OTHER';
  if (key === 'TV' || key === 'TV_SHORT' || key === 'TV SHORT') return 'TV';
  if (key === 'MOVIE' || key === 'FILM') return 'MOVIE';
  if (key === 'OVA' || key === 'SPECIAL' || key === 'ONA SPECIAL')
    return 'SPECIAL';
  if (
    key === 'ONA' ||
    key === 'ONA (CHINESE)' ||
    key === 'ONA(CHINESE)' ||
    key === 'DONGHUA' ||
    key.includes('CHINESE')
  ) {
    return 'DONGHUA';
  }
  if (key === 'MUSIC') return 'MUSIC';
  return 'OTHER';
};

export const minutesForWatched = (
  format: string | null | undefined,
  episodesWatched: number,
): number => {
  const eps = Math.max(0, episodesWatched || 0);
  const bucket = normalizeProfileFormat(format);
  if (bucket === 'MOVIE') return eps * MOVIE_MINUTES;
  return eps * EPISODE_MINUTES;
};
