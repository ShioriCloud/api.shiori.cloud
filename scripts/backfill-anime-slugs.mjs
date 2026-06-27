/**
 * Backfill anime.slug from English/Latin titles (title_romaji or title).
 * Skips Persian-only titles unless mal_id / anilist_id fallback applies.
 *
 * Usage:
 *   DATABASE_URL=... node scripts/backfill-anime-slugs.mjs              # dry-run, missing slugs only
 *   DATABASE_URL=... node scripts/backfill-anime-slugs.mjs --apply
 *   DATABASE_URL=... node scripts/backfill-anime-slugs.mjs --all        # dry-run, recompute ALL slugs
 *   DATABASE_URL=... node scripts/backfill-anime-slugs.mjs --all --apply
 */
import pg from 'pg'
import { loadEnvFile } from './lib/load-env.mjs'
import { allocateUniqueSlug, englishNameSource, suggestAnimeSlug } from './lib/slug.mjs'

loadEnvFile()

const { Client } = pg
const apply = process.argv.includes('--apply')
const all = process.argv.includes('--all')

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    const used = new Set()

    if (!all) {
      const { rows: existingSlugs } = await client.query(
        `SELECT slug FROM anime WHERE slug IS NOT NULL AND trim(slug) <> ''`,
      )
      for (const row of existingSlugs) {
        used.add(String(row.slug).trim())
      }
    }

    const whereClause = all
      ? 'TRUE'
      : `(slug IS NULL OR trim(slug) = '')`

    const { rows: targets } = await client.query(`
      SELECT id, title, title_romaji, mal_id, anilist_id, slug
      FROM anime
      WHERE ${whereClause}
      ORDER BY created_at NULLS LAST, title
    `)

    if (targets.length === 0) {
      console.log(all ? 'No anime rows found.' : 'No anime rows need slug backfill.')
      return
    }

    const mode = `${apply ? 'APPLY' : 'DRY-RUN'}${all ? ' (all rows)' : ''}`
    console.log(`${mode}: ${targets.length} anime row(s)`)

    let updated = 0
    let skipped = 0
    let unchanged = 0

    for (const row of targets) {
      const base = suggestAnimeSlug(row)
      const slug = allocateUniqueSlug(base, used)
      const source = englishNameSource(row)

      if (!slug) {
        skipped += 1
        console.log(`  SKIP ${row.id} — no English name (${row.title ?? 'untitled'})`)
        continue
      }

      if (all && String(row.slug ?? '').trim() === slug) {
        unchanged += 1
        continue
      }

      if (apply) {
        await client.query(`UPDATE anime SET slug = $1 WHERE id = $2`, [slug, row.id])
      }

      updated += 1
      const englishPreview = String(
        source === 'title_romaji' ? row.title_romaji : source === 'title' ? row.title : '',
      ).slice(0, 40)
      const prev = row.slug ? ` (was: ${row.slug})` : ''
      console.log(
        `  ${apply ? 'SET' : 'WOULD SET'} ${slug}  ← ${source}: ${englishPreview}${prev}`,
      )
    }

    console.log(
      `Done. ${updated} ${apply ? 'updated' : 'would update'}, ${unchanged} unchanged, ${skipped} skipped.${apply ? '' : ' Re-run with --apply to write.'}`,
    )
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
