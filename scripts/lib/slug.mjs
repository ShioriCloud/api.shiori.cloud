const SLUG_MAX = 80

/** Persian/Arabic, CJK, Hiragana/Katakana, Hangul */
const NON_LATIN_LETTERS = /[\u0600-\u06FF\u4E00-\u9FFF\u3040-\u30FF\uAC00-\uD7AF]/
const HAS_LATIN = /[a-zA-Z]/

export function normalizeSlug(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, SLUG_MAX)
}

/** True when the string looks like an English/Latin anime title (not Persian etc.). */
export function isLatinTitle(value) {
  const text = String(value ?? '').trim()
  if (!text || !HAS_LATIN.test(text)) return false
  if (NON_LATIN_LETTERS.test(text)) return false
  return true
}

/** Prefer English display title, then romaji — only Latin script. */
export function pickEnglishAnimeName(row) {
  const title = String(row.title ?? '').trim()
  if (isLatinTitle(title)) return title

  const romaji = String(row.title_romaji ?? '').trim()
  if (isLatinTitle(romaji)) return romaji

  return null
}

/** Slug from English name only; external IDs as last resort. */
export function suggestAnimeSlug(row) {
  const english = pickEnglishAnimeName(row)
  if (english) {
    const slug = normalizeSlug(english)
    if (slug) return slug
  }

  if (row.mal_id != null && String(row.mal_id).trim()) {
    return normalizeSlug(`mal-${row.mal_id}`)
  }

  if (row.anilist_id != null && String(row.anilist_id).trim()) {
    return normalizeSlug(`anilist-${row.anilist_id}`)
  }

  return null
}

export function englishNameSource(row) {
  const title = String(row.title ?? '').trim()
  if (isLatinTitle(title)) return 'title'

  const romaji = String(row.title_romaji ?? '').trim()
  if (isLatinTitle(romaji)) return 'title_romaji'

  if (row.mal_id != null && String(row.mal_id).trim()) return 'mal_id'
  if (row.anilist_id != null && String(row.anilist_id).trim()) return 'anilist_id'

  return null
}

export function allocateUniqueSlug(base, used) {
  if (!base) return null

  if (!used.has(base)) {
    used.add(base)
    return base
  }

  for (let i = 2; i < 1000; i += 1) {
    const suffix = `-${i}`
    const trimmed = base.slice(0, Math.max(1, SLUG_MAX - suffix.length))
    const candidate = `${trimmed}${suffix}`
    if (!used.has(candidate)) {
      used.add(candidate)
      return candidate
    }
  }

  return null
}
