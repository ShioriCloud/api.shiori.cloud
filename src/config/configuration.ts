export default () => {
  const appPort = parseInt(process.env.APP_PORT ?? '3000', 10);

  return {
  app: {
    port: appPort,
    host: process.env.APP_HOST ?? '0.0.0.0',
    allowOrigins: (process.env.APP_ALLOW_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:4173,http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
    sync: process.env.DATABASE_SYNC === 'true',
  },
  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    botTokens: (process.env.TELEGRAM_BOT_TOKENS ?? '')
      .split(',')
      .map((value) => value.trim())
      .filter(Boolean),
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? 'ShioriUploadBot',
    /** Mini App host bot (startapp deep links). Separate from file-delivery bot. */
    miniAppBotUsername:
      process.env.TELEGRAM_MINI_APP_BOT_USERNAME ??
      process.env.MINI_APP_BOT_USERNAME ??
      'ShioriMiniBot',
    adminUserId: process.env.ADMIN_USER_ID ?? '',
    postsChannelId:
      process.env.PUBLIC_POSTS_CHANNEL_ID ||
      process.env.ADDITIONAL_CHANNEL_ID ||
      '',
  },
  miniApp: {
    baseUrl: process.env.MINI_APP_URL ?? '',
  },
  cron: {
    secret: process.env.CRON_SECRET ?? '',
  },
  bot: {
    apiToken: process.env.BOT_API_TOKEN ?? '',
  },
  media: {
    storagePath: process.env.MEDIA_STORAGE_PATH ?? './data/uploads',
    publicBaseUrl: (
      process.env.MEDIA_PUBLIC_BASE_URL ?? `http://localhost:${appPort}`
    ).replace(/\/$/, ''),
    maxUploadBytes: parseInt(process.env.MEDIA_MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024), 10),
  },
  /** Local browser testing without Telegram Mini App (never enable in prod). */
  allowDevAuth: process.env.ALLOW_DEV_AUTH === 'true',
  devTelegramUserId: process.env.DEV_TELEGRAM_USER_ID ?? '90344148',
  daramet: {
    webhookSecret: process.env.DARAMET_WEBHOOK_SECRET ?? '',
    donateUrl: process.env.DARAMET_DONATE_URL ?? '',
  },
  subscription: {
    monthlyAmountIrr: parseInt(
      process.env.SUBSCRIPTION_MONTHLY_AMOUNT_IRR ?? '150000',
      10,
    ),
    days: parseInt(process.env.SUBSCRIPTION_DAYS ?? '30', 10),
  },
};
};
