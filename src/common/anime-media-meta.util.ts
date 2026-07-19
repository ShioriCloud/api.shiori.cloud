export type VideoFileType = 'softsub' | 'hardsub'
/** Episode download category shown as tabs in the mini-app */
export type EpisodeVideoFileType = VideoFileType | 'free'
export type VideoResolution = '480p' | '720p' | '1080p'
export type VideoEncode = 'x264' | 'x265' | 'x265_10bit' | 'bluray'
export type HardsubLanguage = 'fa' | 'en'

export const normalizeHardsubLanguage = (value: unknown): HardsubLanguage =>
  String(value ?? '').trim().toLowerCase() === 'en' ? 'en' : 'fa'

export const normalizeVideoFileType = (value: unknown): VideoFileType =>
  String(value ?? '').trim().toLowerCase() === 'hardsub' ? 'hardsub' : 'softsub'

export const normalizeEpisodeVideoFileType = (value: unknown): EpisodeVideoFileType => {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === 'hardsub') return 'hardsub'
  if (v === 'free') return 'free'
  return 'softsub'
}

export const normalizeVideoResolution = (value: unknown): VideoResolution => {
  const v = String(value ?? '').trim().toLowerCase()
  if (v === '480p' || v === '720p' || v === '1080p') return v
  return '1080p'
}

export const normalizeVideoEncode = (value: unknown): VideoEncode => {
  const v = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '_')
  if (v === 'x264' || v === 'x265' || v === 'bluray') return v
  if (v === 'x265_10bit' || v === 'x26510bit') return 'x265_10bit'
  return 'x265_10bit'
}
