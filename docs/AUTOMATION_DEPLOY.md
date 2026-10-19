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

Set:

```env
SUBTITLE_CHANNEL_ID=-100xxxxxxxxxx
```

Bot must be admin in that channel. Redeploy tel-bot.

## 5. Windows worker

Copy updated `softsub-worker`, fill `config.json` (`apiBaseUrl`, `botApiToken`, optional `qbUrl`, optional `telegramApiRoot`).

```powershell
npm install
npm run watch
```

## 6. Smoke test

1. In dash: open an anime automation page → set status `active` → preferred groups.
2. Create manual job for episode N **or** drop a `Title - N [Shiori].zip` in the subtitle channel.
3. If no magnet candidates: job → `AWAITING_SELECTION` → admin selects magnet via API/UI (select-release).
4. After mux: either Local Bot API upload or manual archive → draft preview DM → approve.
