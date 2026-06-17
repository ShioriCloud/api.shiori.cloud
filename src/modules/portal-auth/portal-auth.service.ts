import {
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { Repository } from 'typeorm';
import { TelegramUser, UserPortalSession } from '../../entities';
import { PortalLoginDto } from './portal-auth.dto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STAFF_ROLES = new Set(['admin', 'moderator']);

export type PortalSessionPayload = {
  ok: true;
  token: string;
  user_id: number;
  role: string;
  display_name: string;
  photo_url: string | null;
  expires_at: string;
};

@Injectable()
export class PortalAuthService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
  ) {}

  private isStaffRole(role: string | null | undefined): role is 'admin' | 'moderator' {
    return role != null && STAFF_ROLES.has(role);
  }

  private buildSessionResponse(
    user: TelegramUser,
    token: string,
    expiresAt: Date,
  ): PortalSessionPayload {
    return {
      ok: true,
      token,
      user_id: Number(user.telegramUserId),
      role: user.appRole,
      display_name: user.firstName?.trim() || user.email || 'ادمین',
      photo_url: user.photoUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  async login(dto: PortalLoginDto): Promise<PortalSessionPayload> {
    const email = dto.email.trim().toLowerCase();

    const user = await this.usersRepo
      .createQueryBuilder('u')
      .where('LOWER(TRIM(u.email)) = :email', { email })
      .andWhere('u.portal_login_enabled = true')
      .andWhere('u.password_hash IS NOT NULL')
      .andWhere("u.app_role IN ('admin', 'moderator')")
      .getOne();

    if (!user?.passwordHash) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    user.lastSeenAt = new Date();
    await this.usersRepo.save(user);

    await this.sessionsRepo
      .createQueryBuilder()
      .delete()
      .where('telegram_user_id = :id', { id: user.telegramUserId })
      .andWhere('expires_at < :now', { now: new Date() })
      .execute();

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionsRepo.save({
      token,
      telegramUserId: user.telegramUserId,
      expiresAt,
    });

    return this.buildSessionResponse(user, token, expiresAt);
  }

  async verifySession(token: string): Promise<PortalSessionPayload | null> {
    if (!token.trim()) return null;

    const session = await this.sessionsRepo.findOne({
      where: { token: token.trim() },
    });

    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await this.sessionsRepo.delete({ token: token.trim() });
      return null;
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: session.telegramUserId },
    });

    if (
      !user ||
      !user.portalLoginEnabled ||
      !this.isStaffRole(user.appRole)
    ) {
      await this.sessionsRepo.delete({ token: token.trim() });
      return null;
    }

    return this.buildSessionResponse(user, session.token, session.expiresAt);
  }

  async logout(token: string): Promise<void> {
    if (!token.trim()) return;
    await this.sessionsRepo.delete({ token: token.trim() });
  }
}