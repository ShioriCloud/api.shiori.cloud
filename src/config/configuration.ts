export default () => ({
  app: {
    port: parseInt(process.env.APP_PORT ?? '3001', 10),
    host: process.env.APP_HOST ?? '0.0.0.0',
    allowOrigins: (process.env.APP_ALLOW_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:3001')
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
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? 'ShioriUploadBot',
  },
  miniApp: {
    baseUrl: process.env.MINI_APP_URL ?? '',
  },
  cron: {
    secret: process.env.CRON_SECRET ?? '',
  },
  externalScores: {
    omdbApiKey: process.env.OMDB_API_KEY ?? '',
  },
  media: {
    storagePath: process.env.MEDIA_STORAGE_PATH ?? './data/uploads',
    publicBaseUrl: process.env.MEDIA_PUBLIC_BASE_URL ?? 'http://localhost:3001',
    maxUploadBytes: parseInt(process.env.MEDIA_MAX_UPLOAD_BYTES ?? String(10 * 1024 * 1024), 10),
  },
});
