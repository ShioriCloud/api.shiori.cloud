import { readFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import pg from 'pg'
import { loadEnvFile } from './lib/load-env.mjs'

loadEnvFile()

const { Client } = pg
const __dirname = dirname(fileURLToPath(import.meta.url))

async function main() {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) {
    console.error('DATABASE_URL is required')
    process.exit(1)
  }

  const sqlPath = resolve(__dirname, 'sql', 'media_assets.sql')
  const sql = readFileSync(sqlPath, 'utf8')

  const client = new Client({ connectionString })
  await client.connect()
  try {
    await client.query(sql)
    console.log('OK: media_assets migration applied')
  } finally {
    await client.end()
  }
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
