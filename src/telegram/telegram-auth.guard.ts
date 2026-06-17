import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Request } from 'express';
import { verifyTelegramInitData } from './telegram-init-data';

export type TelegramAuthedRequest = Request & { telegramUserId: number };

@Injectable()
export class TelegramAuthGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest<TelegramAuthedRequest>();
    const initData = String(req.headers['x-telegram-init-data'] ?? '').trim();
    const botToken = this.config.get<string>('telegram.botToken') ?? '';
    const verified = verifyTelegramInitData(initData, botToken);

    if (verified.userId == null) {
      throw new UnauthorizedException(
        `invalid telegram init data (${verified.reason})`,
      );
    }

    req.telegramUserId = verified.userId;
    return true;
  }
}
