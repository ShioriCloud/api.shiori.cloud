import { ValidationPipe, VersioningType } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const port = config.get<number>('app.port', 4001);
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
      'x-telegram-init-data',
      'x-app-session-token',
      'x-portal-token',
    ],
  });

  const swagger = new DocumentBuilder()
    .setTitle('Shiori API')
    .setDescription('Backend for shiori and shiori-admin')
    .setVersion('0.1.0')
    .build();
  SwaggerModule.setup('docs', app, SwaggerModule.createDocument(app, swagger));

  await app.listen(port, host);
  // eslint-disable-next-line no-console
  console.log(`Shiori API: http://${host}:${port}/api/v1`);
  // eslint-disable-next-line no-console
  console.log(`Swagger:    http://${host}:${port}/docs`);
}

bootstrap();
