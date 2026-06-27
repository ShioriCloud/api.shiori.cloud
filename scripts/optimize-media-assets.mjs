/**
 * Re-encode existing media_assets files to WebP (or configured format).
 * URLs stay the same (/media/serve/:id) — only on-disk file + DB metadata change.
 *
 * Usage:
 *   DATABASE_URL=... MEDIA_STORAGE_PATH=./data/uploads node scripts/optimize-media-assets.mjs
 *   ... --apply
 *   ... --apply --force   # re-encode even if already webp
 */
import { readFile, unlink, writeFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import pg from 'pg'
import sharp from 'sharp'
import { loadEnvFile } from './lib/load-env.mjs'

loadEnvFile()

const { Client } = pg

const apply = process.argv.includes('--apply')
const force = process.argv.includes('--force')

const storageRoot = resolve(process.cwd(), process.env.MEDIA_STORAGE_PATH ?? './data/uploads')
const maxWidth = parseInt(process.env.MEDIA_IMAGE_MAX_WIDTH ?? '1920', 10)
const quality = parseInt(process.env.MEDIA_IMAGE_QUALITY ?? '82', 10)
const format = (process.env.MEDIA_IMAGE_FORMAT ?? 'webp').toLowerCase() === 'avif' ? 'avif' : 'webp'

const formatMeta = {
  webp: { mimetype: 'image/webp', extension: '.webp' },
  avif: { mimetype: 'image/avif', extension: '.avif' },
}

async function optimizeBuffer(input, mimetype) {
  const normalizedMime = String(mimetype ?? '').toLowerCase()
  const meta = await sharp(input, { animated: true }).metadata()
  const isAnimated = (meta.pages ?? 1) > 1

  if (normalizedMime === 'image/gif' && isAnimated) {
    return null
  }

  let pipeline = sharp(input, { animated: isAnimated })
    .rotate()
    .resize({ width: maxWidth, withoutEnlargement: true, fit: 'inside' })

  const buffer =
    format === 'avif'
      ? await pipeline.avif({ quality }).toBuffer()
      : await pipeline.webp({ quality }).toBuffer()

  return {
    buffer,
    mimetype: formatMeta[format].mimetype,
    extension: formatMeta[format].extension,
  }
}

function swapExtension(fileName, extension) {
  const base = basename(fileName).replace(/\.[^.]+$/, '')
  return `${base}${extension}`
}

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const client = new Client({ connectionString })
  await client.connect()

  try {
    const { rows } = await client.query(`
      SELECT id, file_name, mimetype, storage_path, size
      FROM media_assets
      WHERE mimetype ILIKE 'image/%'
      ORDER BY created_at ASC
    `)

    console.log(
      `${apply ? 'APPLY' : 'DRY-RUN'}: ${rows.length} image asset(s) | storage=${storageRoot} | ${format} q${quality}`,
    )

    let optimized = 0
    let skipped = 0
    let missing = 0
    let savedBytes = 0

    for (const row of rows) {
      const absPath = join(storageRoot, row.storage_path)
      if (!existsSync(absPath)) {
        missing += 1
        console.log(`  MISSING ${row.id} — ${row.storage_path}`)
        continue
      }

      const currentExt = formatMeta[format].extension
      const alreadyTarget =
        String(row.mimetype).toLowerCase() === formatMeta[format].mimetype &&
        String(row.file_name).toLowerCase().endsWith(currentExt)

      if (alreadyTarget && !force) {
        skipped += 1
        continue
      }

      const input = await readFile(absPath)
      const beforeSize = input.length

      let result
      try {
        result = await optimizeBuffer(input, row.mimetype)
      } catch (err) {
        skipped += 1
        console.log(`  SKIP ${row.id} — optimize failed: ${err instanceof Error ? err.message : err}`)
        continue
      }

      if (!result) {
        skipped += 1
        console.log(`  SKIP ${row.id} — animated GIF`)
        continue
      }

      if (result.buffer.length >= beforeSize && alreadyTarget) {
        skipped += 1
        continue
      }

      const newFileName = swapExtension(row.file_name, result.extension)
      const newStoragePath = join(dirname(row.storage_path), newFileName).replace(/\\/g, '/')
      const newAbsPath = join(storageRoot, newStoragePath)

      const delta = beforeSize - result.buffer.length
      savedBytes += Math.max(0, delta)

      console.log(
        `  ${apply ? 'OPTIMIZE' : 'WOULD'} ${row.file_name} → ${newFileName} (${formatBytes(beforeSize)} → ${formatBytes(result.buffer.length)})`,
      )

      if (apply) {
        await writeFile(newAbsPath, result.buffer)
        await client.query(
          `UPDATE media_assets
           SET file_name = $1, storage_path = $2, mimetype = $3, size = $4, updated_at = now()
           WHERE id = $5`,
          [newFileName, newStoragePath, result.mimetype, String(result.buffer.length), row.id],
        )
        if (newAbsPath !== absPath && existsSync(absPath)) {
          await unlink(absPath)
        }
      }

      optimized += 1
    }

    console.log(
      `Done. optimized=${optimized}, skipped=${skipped}, missing=${missing}, saved≈${formatBytes(savedBytes)}.${apply ? '' : ' Re-run with --apply to write.'}`,
    )
  } finally {
    await client.end()
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
