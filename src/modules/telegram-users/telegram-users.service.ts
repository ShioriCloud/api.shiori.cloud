import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { TelegramUser } from '../../entities';
import { RegisterTelegramUserDto } from './telegram-users.dto';

@Injectable()
export class TelegramUsersService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
  ) {}

  async registerVisit(dto: RegisterTelegramUserDto): Promise<void> {
    const userId = String(dto.telegram_user_id);
    const existing = await this.usersRepo.findOne({
      where: { telegramUserId: userId },
    });

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
      return;
    }

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
}
