export default () => ({
  app: {
    port: parseInt(process.env.APP_PORT ?? '4001', 10),
    host: process.env.APP_HOST ?? '0.0.0.0',
    allowOrigins: (process.env.APP_ALLOW_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
  },
  database: {
    url: process.env.DATABASE_URL ?? '',
    sync: process.env.DATABASE_SYNC === 'true',
  },
});
