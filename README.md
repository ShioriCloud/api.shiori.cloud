# Shiori API

NestJS backend for **shiori-mini-app** and **shiori-admin**. Replaces direct Supabase access over time.

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
| `DATABASE_SYNC` | `true` only for empty local DB — never on Supabase prod |

Point `DATABASE_URL` at your existing Supabase Postgres (Session mode / direct connection) to read the same data the apps use today.

## Modules (planned)

| Module | Prefix | Status |
|--------|--------|--------|
| `anime-catalog` | `/api/v1/anime-catalog` | ✅ read endpoints |
| `portal-auth` | `/api/v1/portal-auth` | planned |
| `user-anime-list` | `/api/v1/user-anime-list` | planned |
| `anime-notifications` | `/api/v1/anime-notifications` | planned |
| `anime-admin` | `/api/v1/anime-admin` | planned |
| `bot-files` | `/api/v1/bot-files` | planned |
| `telegram-users` | `/api/v1/telegram-users` | planned |

## Example endpoints

```
GET /api/v1/anime-catalog/featured
GET /api/v1/anime-catalog/popular
GET /api/v1/anime-catalog/recent
GET /api/v1/anime-catalog/search?q=naruto
GET /api/v1/anime-catalog/genres
GET /api/v1/anime-catalog/:id
GET /api/v1/anime-catalog/studios/:slug
GET /api/v1/anime-catalog/translators/:slug
GET /api/v1/anime-catalog/anilist/:anilistId
```

## Related repos

- `shiori-mini-app` — Telegram Mini App
- `shiori-admin` — Admin panel
