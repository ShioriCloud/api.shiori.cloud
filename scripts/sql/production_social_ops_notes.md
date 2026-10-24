# Social / notifications — production ops

## Database

Apply `production_social_hotfix.sql` on prod Postgres when deploying social notification features (safe to re-run).

## API environment

For Telegram DM buttons on social notifications (`comment_reply`, `social_follow`, `following_comment`, etc.):

```env
MINI_APP_URL=https://shiori.cloud
```

Use the **public** mini-app origin (no trailing slash). Also ensure `TELEGRAM_MINI_APP_BOT_TOKEN` (or main bot token) is set so DMs can be sent.

## Deploy

```bash
cd /opt/api.shiori.cloud && docker compose pull && docker compose up -d --force-recreate
cd /opt/shiori.cloud && docker compose pull && docker compose up -d --force-recreate
```
