const { Client } = require('pg');
const { readFileSync } = require('fs');
const { resolve } = require('path');

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) {
    console.error('DATABASE_URL is required');
    process.exit(1);
  }

  const sqlPath = resolve(__dirname, 'sql', 'media_assets.sql');
  const sql = readFileSync(sqlPath, 'utf8');

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await client.query(sql);
    console.log('OK: media_assets migration applied');
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
