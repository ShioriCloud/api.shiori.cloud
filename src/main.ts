import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 3000);
  const host = config.get<string>('app.host', '0.0.0.0');
  const allowOrigins = config.get<string[]>('app.allowOrigins', []);

  app.useGlobalPipes(
    new ValidationPipe({
      transform: true,
      whitelist: true,
    }),
  );

  app.setGlobalPrefix('api');
  app.enableVersioning({
    type: VersioningType.URI,
    defaultVersion: '1',
  });

  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      const isDev = process.env.NODE_ENV !== 'production';
      const isLocalhost = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin);
      if (isDev && isLocalhost) {
        callback(null, true);
        return;
      }

      callback(new Error('Not allowed by CORS'));
    },
    credentials: true,
    allowedHeaders: [
      'Content-Type',
      'Accept',
      'Authorization',
      'x-telegram-init-data',
      'x-app-session-token',
      'x-portal-token',
      'x-bot-token',
    ],
  });

  const swagger = new DocumentBuilder()
    .setTitle('Shiori API')
    .setDescription('Backend for shiori and shiori-admin')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(port, host);

  const botToken = config.get<string>('telegram.botToken', '').trim();
  if (!botToken) {
    // eslint-disable-next-line no-console
    console.warn(
      'WARNING: TELEGRAM_BOT_TOKEN is not set — Telegram mini-app auth (user list, notifications) will return 401.',
    );
  }

  // eslint-disable-next-line no-console
  console.log(`Shiori API: http://${host}:${port}/api/v1`);
  // eslint-disable-next-line no-console
  console.log(`Swagger:    http://${host}:${port}/docs`);
}

bootstrap();
