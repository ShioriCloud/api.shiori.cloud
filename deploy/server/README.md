# Server deploy — API (Node only)

No nginx in this stack. NestJS listens on `APP_PORT` (default **3000**).  
You point your reverse proxy (Caddy / Traefik / host nginx) at `http://127.0.0.1:3000`.

## `.env` minimum

```env
APP_PORT=3000
APP_HOST=0.0.0.0
TELEGRAM_BOT_TOKEN=...
APP_ALLOW_ORIGINS=https://shiori.cloud,https://dash.shiori.cloud
MEDIA_PUBLIC_BASE_URL=https://api.shiori.cloud
MINI_APP_URL=https://shiori.cloud
DATABASE_SYNC=false
```

### `DATABASE_URL`

| Setup | Example |
|--------|---------|
| Postgres in `docker-compose.yaml` (bundle) | leave unset — compose sets `@postgres:5432` |
| Postgres elsewhere on server | `postgresql://shiori:PASS@172.17.0.1:5432/shiori` or hostname |
| API-only compose + separate postgres container | same Docker network + service name as host |

Never use `localhost` inside the API container for Postgres.

## API only (your case)

```bash
cd /opt/api.shiori.cloud
docker compose -f deploy/server/docker-compose.api-only.yaml pull
docker compose -f deploy/server/docker-compose.api-only.yaml up -d
curl -sf http://127.0.0.1:3000/api/v1/health && echo OK
```

## API + Postgres together

```bash
docker compose -f deploy/server/docker-compose.yaml up -d
```

## Plain docker run (no compose file)

```bash
docker run -d --name api.shiori.cloud --restart unless-stopped \
  -p 3000:3000 \
  --env-file .env \
  -e APP_PORT=3000 \
  -e APP_HOST=0.0.0.0 \
  -e MEDIA_STORAGE_PATH=/app/data/uploads \
  -v shiori_uploads:/app/data/uploads \
  ghcr.io/mrhasanzadeh/shiori-api:latest
```
