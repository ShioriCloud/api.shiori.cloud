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

  async registerVisit(
    dto: RegisterTelegramUserDto,
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
      await this.usersRepo.save({
        telegramUserId: userId,
        firstName,
        lastName: dto.last_name?.trim() || null,
        username: cleanUsername(dto.username),
        languageCode: dto.language_code?.trim() || null,
        photoUrl: dto.photo_url?.trim() || null,
        isPremium: Boolean(dto.is_premium),
        visitCount: 1,
      });
    } else {
      existing.lastSeenAt = new Date();
      existing.visitCount = (existing.visitCount ?? 0) + 1;
      existing.firstName = firstName || existing.firstName;
      if (dto.last_name?.trim()) existing.lastName = dto.last_name.trim();
      const username = cleanUsername(dto.username);
      if (username) existing.username = username;
      if (dto.language_code?.trim()) existing.languageCode = dto.language_code.trim();
      if (dto.photo_url?.trim()) existing.photoUrl = dto.photo_url.trim();
      existing.isPremium = Boolean(dto.is_premium);

      await this.usersRepo.save(existing);
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
