# Deploy — Shiori API

Self-hosted backend for mini-app and admin. Assumes Postgres already has the mini-app schema (migrated from Supabase or copied via `scripts/copy-from-supabase.sh`).

## 1. Environment

```bash
cp .env.example .env
```

Required:

- `DATABASE_URL` — production Postgres
- `APP_ALLOW_ORIGINS` — mini-app + admin URLs
- `TELEGRAM_BOT_TOKEN` — same BotFather token as the mini-app

Recommended:

- `CRON_SECRET` — for weekly score sync
- `MINI_APP_URL` — public mini-app URL (notifications + link flow)
- `TELEGRAM_BOT_USERNAME` — without `@`

Never set `DATABASE_SYNC=true` against a live database.

## 2. Build & run

### Docker (recommended)

```bash
# with bundled Postgres
docker compose -f docker-compose.prod.yml up -d --build

# or API only (external DATABASE_URL in .env)
docker build -t shiori-api .
docker run --rm -p 4001:4001 --env-file .env shiori-api
```

### Node

```bash
npm ci
npm run build
npm run start:prod
```

Or use PM2 / systemd / Docker with `node dist/main.js`.

## 3. Frontends

Build with API URL set (drops `@supabase/supabase-js` from bundle):

```bash
# mini-app
cd ../shiori-mini-app
VITE_SHIORI_API_URL=https://api.example.com npm run build:api

# admin
cd ../shiori-admin
VITE_SHIORI_API_URL=https://api.example.com npm run build:api
```

Serve `dist/` with nginx, Caddy, or static hosting. Example nginx snippet:

```nginx
location / {
  root /var/www/shiori-mini-app/dist;
  try_files $uri $uri/ /index.html;
}
```

| App | Env |
|-----|-----|
| `shiori-mini-app` | `VITE_SHIORI_API_URL=https://api.example.com` |
| `shiori-admin` | `VITE_SHIORI_API_URL=https://api.example.com` |

Supabase env vars are **optional** — only needed if API URL is unset (legacy fallback).

## 4. Cron jobs

### External scores (weekly)

```bash
# Example: process 50 anime per run, loop offsets in your scheduler
curl -sf -X POST \
  "https://api.example.com/api/v1/cron/sync-external-scores?limit=50&offset=0&delay_ms=400" \
  -H "x-cron-secret: $CRON_SECRET"
```

## 5. Health check

```bash
curl -sf https://api.example.com/api/v1/health
```

## 6. Optional SQL

If tables were created before recent API features:

```sql
-- link-telegram tokens
CREATE TABLE IF NOT EXISTS telegram_link_tokens (
  token uuid PRIMARY KEY,
  web_user_id bigint NOT NULL,
  expires_at timestamptz NOT NULL,
  completed_at timestamptz,
  telegram_user_id bigint
);

-- notification campaigns (if missing)
-- see mini-app docs/sql/supabase-notifications.sql
```

## 7. Decommissioning Supabase

Once frontends use only `VITE_SHIORI_API_URL`:

1. Stop using Supabase Edge Functions (`notify-episode-release`, `sync-external-scores`)
2. Remove `VITE_SUPABASE_*` from mini-app and admin `.env`
3. Keep Postgres (can stay on Supabase hosting with direct `DATABASE_URL`, or move to self-hosted)
