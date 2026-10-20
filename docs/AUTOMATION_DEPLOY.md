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
3. Worker searches Nyaa; sole preferred-group hit or clear `pickRelease` winner → qBittorrent. Ambiguous → `AWAITING_SELECTION` (dash). After `nyaaMaxMisses` (default 5) empty searches → `NEEDS_REVIEW`.
4. New/thin profiles auto-seed `alt_titles` + preferred groups (ASW/Judas/Erai-raws/SubsPlease). Overview «نیاز به اقدام» includes selection, stuck search, waiting subtitle, failed.
5. After mux: Local Bot API upload or manual archive → draft preview DM → approve.
6. Admin DMs: tel-bot notifies on subtitle→job start (dash-like status + link). Later attention states (`NEEDS_REVIEW`, `AWAITING_SELECTION`, archive/approval, …) enqueue via API `telegram_dm_outbox`. Set `SHIORI_DASH_URL` on tel-bot (and optionally API) for deep links.
7. Cron (header `x-cron-secret` = `CRON_SECRET`):
   - `POST /api/v1/automation/sync-from-schedule-cron` — weekly config seed
   - `POST /api/v1/automation/escalate-stale-cron` — mid-pipeline stale → `NEEDS_REVIEW`
8. Dash can approve `AWAITING_APPROVAL` jobs (`request-publish`); tel-bot poller publishes then marks job `PUBLISHED`. Ambiguous subs: tab «ساب مبهم».
