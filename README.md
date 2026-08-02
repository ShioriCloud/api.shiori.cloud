# Shiori API

NestJS backend for **shiori** and **shiori-admin**. Primary data layer for the mini-app and admin panel.

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
| `BOT_API_TOKEN` | Protects `GET /api/v1/bot/*` (`x-bot-token` header) |

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
| `bot` | `/bot` | Tel-bot file/link lookup (`x-bot-token`) |
| `notifications-admin` | `/notifications-admin` | Episode release campaigns |
| `external-scores` | `/cron` | Batch score sync (cron) |

## Cron: external scores

```bash
curl -X POST "http://localhost:4001/api/v1/cron/sync-external-scores?limit=25&offset=0" \
  -H "x-cron-secret: YOUR_CRON_SECRET"
```

Paginate with `offset` until `hasMore` is false, or run:

```bash
SHIORI_API_URL=https://api.shiori.cloud CRON_SECRET=... npm run cron:sync-external-scores
```

Weekly GitHub Action: `.github/workflows/sync-external-scores.yml` (secrets: `SHIORI_API_URL`, `CRON_SECRET`).

## Bot API (tel-bot)

All routes require header `x-bot-token: YOUR_BOT_API_TOKEN`.

```bash
# Health (startup check)
curl -s "https://api.shiori.cloud/api/v1/bot/health" -H "x-bot-token: TOKEN"

# Resolve archive link
curl -s "https://api.shiori.cloud/api/v1/bot/archive-links/482391056" \
  -H "x-bot-token: TOKEN"
```

| Method | Path | Purpose |
|--------|------|---------|
| `GET` | `/bot/health` | Startup ping |
| `GET` | `/bot/archive-links/:code` | Public link lookup |
| `GET` | `/bot/files/:key` | Active file by key |
| `POST` | `/bot/files` | Create file |
| `PUT` | `/bot/files/:key` | Upsert (reindex) |
| `POST` | `/bot/files/:key/downloads` | Increment downloads |
| `PATCH` | `/bot/files/by-message/:messageId` | Update by Telegram message id |
| `POST` | `/bot/files/by-message/:messageId/deactivate` | Deactivate by message id |
| `GET` | `/bot/packs/:slug` | File pack metadata |
| `GET` | `/bot/packs/:packId/items` | Pack items |
| `GET/PUT/DELETE` | `/bot/settings/:key` | Bot runtime settings (e.g. mirroring) |

Response for archive link: `{ ok: true, data: { id, code, title?, type?, telegramFileId?, archiveMessageId?, caption? } }` — `404` if missing or inactive.

## Related repos

- `shiori` — Telegram Mini App (+ web profile)
- `shiori-admin` — Admin panel

See [DEPLOY.md](./DEPLOY.md) for production checklist.
