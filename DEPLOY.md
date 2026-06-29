# Deploy — Shiori API

Self-hosted backend for mini-app and admin. Assumes Postgres already has the mini-app schema.

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

## 1b. Server troubleshooting (`ECONNREFUSED` on database)

If API logs show `Unable to connect to the database` / `ECONNREFUSED`:

1. **`localhost` inside Docker is wrong** — the API container cannot reach Postgres on the host via `localhost:5433`. Use the compose stack below, or set `DATABASE_URL` to the Postgres **service name** / host IP (never `127.0.0.1` from inside a container).

2. **Recommended on server** (`/opt/api.shiori.cloud`):

```bash
cd /opt/api.shiori.cloud
cp .env.example .env   # set TELEGRAM_BOT_TOKEN, POSTGRES_PASSWORD, APP_ALLOW_ORIGINS, …
# Do NOT set DATABASE_URL to localhost when using compose prod

docker compose -f docker-compose.prod.yml up -d --build
docker compose -f docker-compose.prod.yml ps
docker logs api.shiori.cloud -f
```

3. **Postgres must be running** on the same Docker network:

```bash
docker ps | grep postgres
docker exec shiori-postgres pg_isready -U shiori -d shiori
```

4. **API-only container** (no compose postgres): point `DATABASE_URL` at a reachable host, e.g. managed DB hostname or `172.17.0.1` (Docker bridge to host) — not `localhost`.

Example `.env` for production compose:

```env
POSTGRES_PASSWORD=strong-secret
TELEGRAM_BOT_TOKEN=...
APP_ALLOW_ORIGINS=https://shiori.cloud,https://dash.shiori.cloud
MEDIA_PUBLIC_BASE_URL=https://api.shiori.cloud
MINI_APP_URL=https://shiori.cloud
```

## 2. Build & run

### Pull from GHCR (CI)

On push to `main` / tag `v*`, GitHub Actions publishes:

```text
ghcr.io/<owner>/shiori-api:latest
ghcr.io/<owner>/shiori-admin:latest
ghcr.io/<owner>/shiori:latest
```

Set repository **Variables** for frontend builds (optional — defaults to `https://api.shiori.cloud`):

- `VITE_SHIORI_API_URL` — public API URL baked into SPA builds
- `VITE_TELEGRAM_BOT_USERNAME` — optional, defaults to `ShioriUploadBot`

```bash
docker pull ghcr.io/<owner>/shiori-api:latest
docker run --rm -p 4001:4001 --env-file .env ghcr.io/<owner>/shiori-api:latest
```

### Docker (local build)

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

Build with API URL set:

```bash
# shiori (mini-app frontend)
cd ../shiori
VITE_SHIORI_API_URL=https://api.example.com npm run build

# admin
cd ../shiori-admin
VITE_SHIORI_API_URL=https://api.example.com npm run build
```

Serve `dist/` with nginx, Caddy, or static hosting. Example nginx snippet:

```nginx
location / {
  root /var/www/shiori/dist;
  try_files $uri $uri/ /index.html;
}
```

| App | Env |
|-----|-----|
| `shiori` | `VITE_SHIORI_API_URL=https://api.example.com` |
| `shiori-admin` | `VITE_SHIORI_API_URL=https://api.example.com` |

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

If tables were created before recent API features, apply the catch-up script (safe to re-run):

```bash
# Local Postgres in docker-compose.yml
docker exec -i apishioricloud-postgres-1 psql -U shiori -d shiori \
  < scripts/sql/production_schema_catchup.sql

# Production compose
npm run db:schema-catchup:docker
```

Or only slug column:

```bash
docker exec -i shiori-postgres psql -U shiori -d shiori < scripts/sql/anime_slug.sql
```

### Maintenance scripts (after deploy)

Requires `DATABASE_URL` in the environment (or `.env` loaded by your shell).

```bash
# 1) Backfill anime.slug from English title (title_romaji or Latin title); use --all to recompute existing
npm run db:backfill-anime-slugs
npm run db:backfill-anime-slugs:apply
node scripts/backfill-anime-slugs.mjs --all          # dry-run all rows
node scripts/backfill-anime-slugs.mjs --all --apply

# 2) Re-encode existing media library images to WebP (URLs unchanged)
npm run db:optimize-media
MEDIA_STORAGE_PATH=./data/uploads npm run db:optimize-media:apply

# On server (API container has DATABASE_URL + volume at /app/data/uploads):
docker exec -e MEDIA_STORAGE_PATH=/app/data/uploads api.shiori.cloud \
  node scripts/optimize-media-assets.mjs --apply
```

Priority: **schema catch-up** → deploy API → **backfill slugs** → **optimize media** (optional, I/O heavy).

Legacy one-offs:

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
-- see shiori/sql/notifications.sql
```
