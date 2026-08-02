#!/usr/bin/env node
/**
 * Paginate POST /api/v1/cron/sync-external-scores until hasMore is false.
 *
 * Usage:
 *   SHIORI_API_URL=https://api.shiori.cloud \
 *   CRON_SECRET=... \
 *   node scripts/backfill-external-scores.mjs
 *
 * Optional:
 *   LIMIT=50 DELAY_MS=400 OFFSET=0
 */
const apiBase = String(process.env.SHIORI_API_URL || process.env.API_BASE_URL || '')
  .trim()
  .replace(/\/+$/, '')
const secret = String(process.env.CRON_SECRET || '').trim()
const limit = Math.min(Math.max(Number(process.env.LIMIT || 50) || 50, 1), 100)
const delayMs = Math.min(Math.max(Number(process.env.DELAY_MS || 400) || 400, 0), 2000)
let offset = Math.max(Number(process.env.OFFSET || 0) || 0, 0)

if (!apiBase) {
  console.error('SHIORI_API_URL (or API_BASE_URL) is required')
  process.exit(1)
}
if (!secret) {
  console.error('CRON_SECRET is required')
  process.exit(1)
}

const endpoint = `${apiBase}/api/v1/cron/sync-external-scores`

async function syncPage(pageOffset) {
  const url = new URL(endpoint)
  url.searchParams.set('limit', String(limit))
  url.searchParams.set('offset', String(pageOffset))
  url.searchParams.set('delay_ms', String(delayMs))

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'x-cron-secret': secret,
    },
  })

  const text = await res.text()
  let json
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = null
  }

  if (!res.ok) {
    throw new Error(
      `HTTP ${res.status}: ${typeof json === 'object' && json?.message ? json.message : text || res.statusText}`
    )
  }

  return json
}

async function main() {
  console.log(`Backfill external scores via ${endpoint}`)
  console.log(`limit=${limit} delay_ms=${delayMs} start_offset=${offset}`)

  let totalProcessed = 0
  let totalUpdated = 0
  let pages = 0

  for (;;) {
    const result = await syncPage(offset)
    pages += 1
    const processed = Number(result?.processed ?? 0)
    const updated = Number(result?.updated ?? 0)
    totalProcessed += processed
    totalUpdated += updated

    console.log(
      `page=${pages} offset=${offset} processed=${processed} updated=${updated}` +
        (Array.isArray(result?.errors) && result.errors.length
          ? ` errors=${result.errors.length}`
          : '')
    )

    if (Array.isArray(result?.errors)) {
      for (const err of result.errors.slice(0, 5)) {
        console.warn(`  ! id=${err.id}: ${err.message}`)
      }
      if (result.errors.length > 5) {
        console.warn(`  … ${result.errors.length - 5} more errors`)
      }
    }

    if (!result?.hasMore) break
    offset =
      typeof result.nextOffset === 'number' ? result.nextOffset : offset + limit
  }

  console.log(
    `Done. pages=${pages} processed=${totalProcessed} updated=${totalUpdated}`
  )
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err)
  process.exit(1)
})
