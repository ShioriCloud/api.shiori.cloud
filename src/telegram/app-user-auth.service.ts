import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser, UserPortalSession } from '../entities';
import { getTelegramBotTokens } from './telegram-bot-tokens';
import { verifyTelegramInitData } from './telegram-init-data';

export type ResolvedAppUserAuth = {
  telegramUserId: number;
  authMethod: 'telegram' | 'session';
};

export type AppUserAuthFailure = {
  reason: string;
};

const readInitData = (
  headers: Record<string, string | string[] | undefined>,
  body?: Record<string, unknown>,
): string => {
  const headerValue = String(headers['x-telegram-init-data'] ?? '').trim();
  if (headerValue) return headerValue;

  const bodyValue =
    typeof body?.telegram_init_data === 'string'
      ? body.telegram_init_data.trim()
      : '';

  return bodyValue;
};

@Injectable()
export class AppUserAuthService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
  ) {}

  async assertNotBanned(telegramUserId: number): Promise<void> {
    const user = await this.usersRepo.findOne({
      where: { telegramUserId: String(telegramUserId) },
      select: { telegramUserId: true, isBanned: true },
    });
    if (user?.isBanned) {
      throw new ForbiddenException('account banned');
    }
  }

  async resolveAuth(
    headers: Record<string, string | string[] | undefined>,
    body?: Record<string, unknown>,
  ): Promise<ResolvedAppUserAuth | AppUserAuthFailure | null> {
    const initData = readInitData(headers, body);
    const botTokens = getTelegramBotTokens(this.config);

    if (initData) {
      const verified = verifyTelegramInitData(initData, botTokens);
      if (verified.userId != null) {
        return { telegramUserId: verified.userId, authMethod: 'telegram' };
      }

      const sessionToken = String(headers['x-app-session-token'] ?? '').trim();
      if (!sessionToken) {
        return { reason: verified.reason };
      }
    }

    const sessionToken = String(headers['x-app-session-token'] ?? '').trim();
    if (!sessionToken) return null;

    const session = await this.sessionsRepo.findOne({
      where: { token: sessionToken },
    });

    if (session && session.expiresAt.getTime() > Date.now()) {
      return {
        telegramUserId: Number(session.telegramUserId),
        authMethod: 'session',
      };
    }

    if (session) {
      await this.sessionsRepo.delete({ token: sessionToken });
    }

    return initData ? { reason: 'invalid_session' } : null;
  }
}
