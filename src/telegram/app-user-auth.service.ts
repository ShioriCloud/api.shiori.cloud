import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser, UserPortalSession } from '../entities';
import { getTelegramBotTokens } from './telegram-bot-tokens';
import { verifyTelegramInitData } from './telegram-init-data';
import { readSessionTokenFromRequest } from './read-session-token';

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

  /** Keep admin last-seen in sync even when Mini App auth uses a stored session. */
  private async touchLastSeen(telegramUserId: string): Promise<void> {
    const id = String(telegramUserId ?? '').trim();
    if (!id) return;
    await this.usersRepo.query(
      `
      INSERT INTO telegram_users (telegram_user_id, first_name)
      VALUES ($1, 'کاربر')
      ON CONFLICT (telegram_user_id) DO UPDATE SET
        last_seen_at = NOW(),
        visit_count = telegram_users.visit_count + CASE
          WHEN telegram_users.last_seen_at IS NULL
            OR telegram_users.last_seen_at < NOW() - INTERVAL '30 minutes' THEN 1
          ELSE 0
        END
      WHERE telegram_users.last_seen_at IS NULL
        OR telegram_users.last_seen_at < NOW() - INTERVAL '1 minute'
      `,
      [id],
    );
  }

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
    const sessionToken = readSessionTokenFromRequest(headers, body);

    if (initData) {
      const verified = verifyTelegramInitData(initData, botTokens);
      if (verified.userId != null) {
        await this.touchLastSeen(String(verified.userId));
        return { telegramUserId: verified.userId, authMethod: 'telegram' };
      }

      if (!sessionToken) {
        return { reason: verified.reason };
      }
    }

    if (!sessionToken) return null;

    const session = await this.sessionsRepo.findOne({
      where: { token: sessionToken },
    });

    if (session && session.expiresAt.getTime() > Date.now()) {
      const telegramUserId = Number(session.telegramUserId);
      await this.touchLastSeen(String(session.telegramUserId));
      return {
        telegramUserId,
        authMethod: 'session',
      };
    }

    if (session) {
      await this.sessionsRepo.delete({ token: sessionToken });
    }

    return initData ? { reason: 'invalid_session' } : null;
  }
}
