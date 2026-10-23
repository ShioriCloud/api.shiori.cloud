import { ForbiddenException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { TelegramUser, UserPortalSession } from '../../entities';
import { RegisterTelegramUserDto } from './telegram-users.dto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

@Injectable()
export class TelegramUsersService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
  ) {}

  /**
   * Bump last_seen_at, creating the row if this Telegram id is new.
   * visit_count only increases if the previous visit was more than 30 minutes ago.
   */
  async touchLastSeen(telegramUserId: string): Promise<void> {
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
      `,
      [id],
    );
  }

  /**
   * File-delivery bot already knows the Telegram user. Record that as a visit
   * even when the Mini App register ping never ran (public episode pages).
   */
  async recordBotVisit(input: {
    telegram_user_id: number;
    first_name?: string | null;
    last_name?: string | null;
    username?: string | null;
    language_code?: string | null;
    is_premium?: boolean;
  }): Promise<void> {
    const userId = String(input.telegram_user_id ?? '').trim();
    if (!userId || !/^\d+$/.test(userId)) return;

    const existing = await this.usersRepo.findOne({
      where: { telegramUserId: userId },
    });

    const cleanUsername = (value?: string | null): string | null => {
      const trimmed = String(value ?? '')
        .trim()
        .replace(/^@+/, '');
      return trimmed || null;
    };

    const firstName = String(input.first_name ?? '').trim() || 'کاربر';

    if (!existing) {
      const now = new Date();
      await this.usersRepo.save({
        telegramUserId: userId,
        firstName,
        lastName: input.last_name?.trim() || null,
        username: cleanUsername(input.username),
        languageCode: input.language_code?.trim() || null,
        isPremium: Boolean(input.is_premium),
        visitCount: 1,
        lastSeenAt: now,
      });
      return;
    }

    existing.firstName = firstName || existing.firstName;
    if (input.last_name?.trim()) existing.lastName = input.last_name.trim();
    const username = cleanUsername(input.username);
    if (username) existing.username = username;
    if (input.language_code?.trim()) existing.languageCode = input.language_code.trim();
    existing.isPremium = Boolean(input.is_premium);
    await this.usersRepo.save(existing);
    await this.touchLastSeen(userId);
  }

  /**
   * When initData is stale/invalid but a live mini-app session exists,
   * still record the visit so admin "last seen" stays accurate.
   */
  async touchVisitFromSession(
    telegramUserId: number,
    sessionToken: string | null | undefined,
  ): Promise<{ session_token: string; expires_at: string } | null> {
    const token = String(sessionToken ?? '').trim();
    if (!token) return null;

    const userId = String(telegramUserId);
    const session = await this.sessionsRepo.findOne({ where: { token } });
    if (!session) return null;
    if (String(session.telegramUserId) !== userId) return null;
    if (session.expiresAt.getTime() <= Date.now()) {
      await this.sessionsRepo.delete({ token });
      return null;
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: userId },
      select: { telegramUserId: true, isBanned: true },
    });
    if (user?.isBanned) {
      throw new ForbiddenException('account banned');
    }

    await this.touchLastSeen(userId);
    return {
      session_token: session.token,
      expires_at: session.expiresAt.toISOString(),
    };
  }

  async registerVisit(
    dto: RegisterTelegramUserDto,
    existingSessionToken?: string | null,
  ): Promise<{ session_token: string; expires_at: string }> {
    const userId = String(dto.telegram_user_id);
    const existing = await this.usersRepo.findOne({
      where: { telegramUserId: userId },
    });

    if (existing?.isBanned) {
      throw new ForbiddenException('account banned');
    }

    const cleanUsername = (value?: string | null): string | null => {
      const trimmed = String(value ?? '')
        .trim()
        .replace(/^@+/, '');
      return trimmed || null;
    };

    const firstName = String(dto.first_name ?? '').trim() || 'کاربر';

    if (!existing) {
      const now = new Date();
      await this.usersRepo.save({
        telegramUserId: userId,
        firstName,
        lastName: dto.last_name?.trim() || null,
        username: cleanUsername(dto.username),
        languageCode: dto.language_code?.trim() || null,
        photoUrl: dto.photo_url?.trim() || null,
        isPremium: Boolean(dto.is_premium),
        visitCount: 1,
        lastSeenAt: now,
      });
    } else {
      existing.firstName = firstName || existing.firstName;
      if (dto.last_name?.trim()) existing.lastName = dto.last_name.trim();
      const username = cleanUsername(dto.username);
      if (username) existing.username = username;
      if (dto.language_code?.trim()) existing.languageCode = dto.language_code.trim();
      if (dto.photo_url?.trim()) existing.photoUrl = dto.photo_url.trim();
      existing.isPremium = Boolean(dto.is_premium);
      await this.usersRepo.save(existing);
      await this.touchLastSeen(userId);
    }

    const reuseToken = String(existingSessionToken ?? '').trim();
    if (reuseToken) {
      const session = await this.sessionsRepo.findOne({
        where: { token: reuseToken },
      });
      if (
        session &&
        String(session.telegramUserId) === userId &&
        session.expiresAt.getTime() > Date.now()
      ) {
        return {
          session_token: session.token,
          expires_at: session.expiresAt.toISOString(),
        };
      }
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await this.sessionsRepo.save({
      token,
      telegramUserId: userId,
      expiresAt,
    });

    return {
      session_token: token,
      expires_at: expiresAt.toISOString(),
    };
  }
}
