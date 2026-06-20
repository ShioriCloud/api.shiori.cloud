# Shiori API

NestJS backend for **shiori** and **shiori-admin**. Primary data layer — Supabase client is no longer required in the frontends when `VITE_SHIORI_API_URL` is set.

## Stack

- NestJS 10
- TypeORM + PostgreSQL
- Swagger at `/docs`

## Quick start

```bash
npm install
cp .env.example .env

# optional: local Postgres
docker compose up -d

npm run start:dev
```

- API base: `http://localhost:4001/api/v1`
- Health: `GET /api/v1/health`
- Swagger: `http://localhost:4001/docs`

## Environment

| Variable | Description |
|----------|-------------|
| `APP_PORT` | HTTP port (default `4001`) |
| `APP_ALLOW_ORIGINS` | CORS origins (comma-separated) |
| `DATABASE_URL` | Postgres connection string |
| `DATABASE_SYNC` | `true` only for empty local DB |
| `TELEGRAM_BOT_TOKEN` | Verify Telegram `initData` + send DM notifications |
| `TELEGRAM_BOT_USERNAME` | Deep-link bot name (link-telegram flow) |
| `MINI_APP_URL` | Web App button URL in Telegram notifications |
| `CRON_SECRET` | Protects `POST /api/v1/cron/*` |
| `OMDB_API_KEY` | Optional IMDb score source |

Point `DATABASE_URL` at the same Postgres used by the mini-app (direct connection or local docker).

## Modules

| Module | Prefix | Purpose |
|--------|--------|---------|
| `anime-catalog` | `/anime-catalog` | Public catalog reads |
| `app-auth` | `/app-auth` | Web login/register + link-telegram |
| `anime-notifications` | `/anime-notifications` | User inbox + preferences |
| `user-anime-list` | `/user-anime-list` | Favorites / watch progress |
| `telegram-users` | `/telegram-users` | Register Telegram visits |
| `portal-auth` | `/portal-auth` | Admin panel login |
| `anime-admin` | `/anime-admin` | Anime CRUD (staff) |
| `telegram-users-admin` | `/telegram-users-admin` | User management |
| `files-admin` | `/files-admin` | Files + file packs |
| `notifications-admin` | `/notifications-admin` | Episode release campaigns |
| `external-scores` | `/cron` | Batch score sync (cron) |

## Cron: external scores

Replaces Supabase Edge `sync-external-scores`:

```bash
curl -X POST "http://localhost:4001/api/v1/cron/sync-external-scores?limit=25&offset=0" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

Paginate with `offset` until `hasMore` is false. Schedule weekly (system cron, GitHub Actions, etc.).

## Related repos

- `shiori` — Telegram Mini App (+ web profile)
- `shiori-admin` — Admin panel

See [DEPLOY.md](./DEPLOY.md) for production checklist.
