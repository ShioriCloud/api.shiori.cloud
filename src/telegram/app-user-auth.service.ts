import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserPortalSession } from '../entities';
import { verifyTelegramInitData } from './telegram-init-data';

export type ResolvedAppUserAuth = {
  telegramUserId: number;
  authMethod: 'telegram' | 'session';
};

@Injectable()
export class AppUserAuthService {
  constructor(
    private readonly config: ConfigService,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
  ) {}

  async resolveAuth(
    headers: Record<string, string | string[] | undefined>,
  ): Promise<ResolvedAppUserAuth | null> {
    const initData = String(headers['x-telegram-init-data'] ?? '').trim();
    const botToken = this.config.get<string>('telegram.botToken') ?? '';

    if (initData) {
      const verified = verifyTelegramInitData(initData, botToken);
      if (verified.userId != null) {
        return { telegramUserId: verified.userId, authMethod: 'telegram' };
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

    return null;
  }
}
