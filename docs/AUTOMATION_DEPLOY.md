# Deploy checklist — Shiori automation

## 1. Database

```bash
docker exec -i postgres \
  env PGPASSWORD='…' \
  psql -U dawn -d shiori-cloud \
  < scripts/sql/automation_tables.sql
```

## 2. API

Deploy latest `api.shiori.cloud` (module `AutomationModule`).

Bot auth: existing `BOT_API_TOKEN` / `x-bot-token`.  
Admin: existing `x-portal-token`.

## 3. Dashboard

Deploy `dash.shiori.cloud` — nav item **اتوماسیون** → `/admin/automation`.

## 4. tel-bot

Translator channel: **Shiori Files | آرشیو زیرنویس تیم**

```env
SUBTITLE_CHANNEL_ID=-1003282972743
```

Bot must be **administrator** in that channel (otherwise Telegram never sends `channel_post` and logs stay empty). Redeploy/restart tel-bot, then confirm:

```bash
docker exec <tel-bot> printenv SUBTITLE_CHANNEL_ID
docker logs --tail 50 <tel-bot> 2>&1 | grep -E 'SUBTITLE|Channel routing'
```

Do **not** call `getUpdates` with the same `BOT_TOKEN` (it steals updates from the running bot).

## 5. Windows worker

Copy updated `softsub-worker`, fill `config.json` (`apiBaseUrl`, `botApiToken`, optional `qbUrl`, optional `telegramApiRoot`).

```powershell
npm install
npm run watch
```

## 6. Smoke test

1. In dash: open an anime automation page → set status `active` → `preferred_groups` + `alt_titles`.
2. Drop a `Title - N [Shiori].zip` in the subtitle channel (or manual job).
3. Worker searches Nyaa; if unique preferred match → downloads via qBittorrent. If ambiguous/empty → `AWAITING_SELECTION` (pick in dash job page or Retry).
4. After mux: Local Bot API upload or manual archive → draft preview DM → approve.
