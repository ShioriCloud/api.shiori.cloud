import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { randomUUID } from 'crypto';
import { DataSource, Repository } from 'typeorm';
import {
  TelegramLinkToken,
  TelegramUser,
  UserAnimeListEntry,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserPortalSession,
} from '../../entities';
import { verifyTelegramInitData } from '../../telegram/telegram-init-data';
import { getTelegramBotTokens } from '../../telegram/telegram-bot-tokens';
import {
  AppLoginDto,
  AppRegisterDto,
  CompleteTelegramLinkDto,
  LinkTelegramCredentialsDto,
  LinkTelegramStartDto,
} from './app-auth.dto';

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const LINK_TOKEN_TTL_MS = 15 * 60 * 1000;

export type LinkTelegramStatus =
  | 'pending'
  | 'completed'
  | 'expired'
  | 'invalid';

@Injectable()
export class AppAuthService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
    @InjectRepository(TelegramLinkToken)
    private readonly linkTokensRepo: Repository<TelegramLinkToken>,
    @InjectDataSource()
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
  ) {}

  private isWebUserId(userId: string | number): boolean {
    return Number(userId) < 0;
  }

  private isTelegramUserId(userId: string | number): boolean {
    return Number(userId) > 0;
  }

  private resolveTelegramUserId(initDataHeader?: string | string[]): number {
    const initData = String(
      Array.isArray(initDataHeader)
        ? initDataHeader[0]
        : (initDataHeader ?? ''),
    ).trim();
    const botTokens = getTelegramBotTokens(this.config);
    const verified = verifyTelegramInitData(initData, botTokens);

    if (verified.userId == null) {
      throw new UnauthorizedException('invalid telegram init data');
    }

    return verified.userId;
  }

  private async nextWebUserId(): Promise<string> {
    const row = await this.usersRepo
      .createQueryBuilder('u')
      .select('MIN(u.telegram_user_id)', 'minId')
      .where('u.telegram_user_id < 0')
      .getRawOne<{ minId: string | null }>();

    const minId = row?.minId != null ? Number(row.minId) : 0;
    return String(minId <= 0 ? minId - 1 : -1_000_001);
  }

  private buildSessionResponse(
    user: TelegramUser,
    token: string,
    expiresAt: Date,
  ) {
    return {
      ok: true,
      token,
      user_id: Number(user.telegramUserId),
      display_name: user.firstName?.trim() || user.email || 'کاربر',
      email: user.email,
      expires_at: expiresAt.toISOString(),
      auth_method: 'web' as const,
    };
  }

  private async createSession(user: TelegramUser) {
    const token = randomUUID();
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

    await this.sessionsRepo.save({
      token,
      telegramUserId: user.telegramUserId,
      expiresAt,
    });

    return this.buildSessionResponse(user, token, expiresAt);
  }

  private async findWebUserByCredentials(dto: LinkTelegramCredentialsDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.usersRepo
      .createQueryBuilder('u')
      .where('LOWER(TRIM(u.email)) = :email', { email })
      .andWhere('u.password_hash IS NOT NULL')
      .getOne();

    if (!user?.passwordHash) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    if (!this.isWebUserId(user.telegramUserId)) {
      throw new BadRequestException('این حساب قبلاً به Telegram وصل شده است');
    }

    return user;
  }

  private async mergeWebUserIntoTelegram(
    webUserId: string,
    telegramUserId: string,
  ): Promise<void> {
    if (!this.isWebUserId(webUserId)) {
      throw new BadRequestException('حساب وب معتبر نیست');
    }
    if (!this.isTelegramUserId(telegramUserId)) {
      throw new BadRequestException('شناسه Telegram معتبر نیست');
    }
    if (webUserId === telegramUserId) {
      throw new BadRequestException('این حساب‌ها قبلاً یکی هستند');
    }

    const webUser = await this.usersRepo.findOne({
      where: { telegramUserId: webUserId },
    });
    const tgUser = await this.usersRepo.findOne({
      where: { telegramUserId: telegramUserId },
    });

    if (!webUser) {
      throw new NotFoundException('حساب وب یافت نشد');
    }
    if (!tgUser) {
      throw new NotFoundException(
        'کاربر Telegram یافت نشد — یک‌بار مینی‌اپ را باز کنید',
      );
    }

    if (tgUser.email?.trim() && webUser.email?.trim()) {
      const tgEmail = tgUser.email.trim().toLowerCase();
      const webEmail = webUser.email.trim().toLowerCase();
      if (tgEmail !== webEmail) {
        throw new ConflictException(
          'حساب Telegram از قبل ایمیل دیگری دارد — با پشتیبانی تماس بگیرید',
        );
      }
    }

    await this.dataSource.transaction(async (manager) => {
      const webEntries = await manager.find(UserAnimeListEntry, {
        where: { telegramUserId: webUserId },
      });

      for (const entry of webEntries) {
        const existing = await manager.findOne(UserAnimeListEntry, {
          where: { telegramUserId, animeId: entry.animeId },
        });

        if (existing) {
          const episodes = Math.max(
            existing.episodesWatched ?? 0,
            entry.episodesWatched ?? 0,
          );
          const rating = existing.userRating ?? entry.userRating;

          await manager.update(
            UserAnimeListEntry,
            { id: existing.id },
            {
              episodesWatched: episodes,
              userRating: rating,
              updatedAt: new Date(),
            },
          );
          await manager.delete(UserAnimeListEntry, { id: entry.id });
        } else {
          await manager.update(
            UserAnimeListEntry,
            { id: entry.id },
            {
              telegramUserId,
              updatedAt: new Date(),
            },
          );
        }
      }

      await manager.update(
        UserNotification,
        { telegramUserId: webUserId },
        { telegramUserId },
      );

      const webLists = await manager.find(UserCustomList, {
        where: { telegramUserId: webUserId },
        relations: { items: true },
        order: { createdAt: 'ASC' },
      });
      const tgLists = await manager.find(UserCustomList, {
        where: { telegramUserId },
        relations: { items: true },
        order: { createdAt: 'ASC' },
      });
      const listNameKey = (name: string) => name.trim().toLowerCase();

      for (const webList of webLists) {
        const match = tgLists.find(
          (list) => listNameKey(list.name) === listNameKey(webList.name),
        );
        const target = match ?? (tgLists.length < 5 ? null : tgLists[0]);

        if (!match && tgLists.length < 5) {
          await manager.update(
            UserCustomList,
            { id: webList.id },
            { telegramUserId, updatedAt: new Date() },
          );
          tgLists.push({ ...webList, telegramUserId } as UserCustomList);
          continue;
        }

        if (!target) continue;

        const existingIds = new Set(
          (target.items ?? []).map((item) => item.animeId),
        );
        let position = (target.items ?? []).reduce(
          (max, item) => Math.max(max, item.position),
          -1,
        );
        for (const item of [...(webList.items ?? [])].sort(
          (a, b) => a.position - b.position,
        )) {
          if (existingIds.has(item.animeId)) continue;
          position += 1;
          await manager.save(
            UserCustomListItem,
            manager.create(UserCustomListItem, {
              listId: target.id,
              animeId: item.animeId,
              position,
            }),
          );
          existingIds.add(item.animeId);
          target.items = [
            ...(target.items ?? []),
            { animeId: item.animeId, position } as UserCustomListItem,
          ];
        }
        await manager.delete(UserCustomList, { id: webList.id });
      }

      await manager.delete(UserPortalSession, { telegramUserId: webUserId });

      if (!tgUser.email?.trim() && webUser.email?.trim()) {
        tgUser.email = webUser.email.trim().toLowerCase();
        tgUser.passwordHash = webUser.passwordHash;
        tgUser.portalLoginEnabled = webUser.portalLoginEnabled;
      }

      if (!tgUser.firstName?.trim() && webUser.firstName?.trim()) {
        tgUser.firstName = webUser.firstName.trim();
      }

      if (webUser.notifyNewEpisode === false) {
        tgUser.notifyNewEpisode = false;
      }
      if (webUser.notifyTelegramDm === false) {
        tgUser.notifyTelegramDm = false;
      }

      await manager.save(TelegramUser, tgUser);
      await manager.delete(TelegramUser, { telegramUserId: webUserId });
    });
  }

  async register(dto: AppRegisterDto) {
    const email = dto.email.trim().toLowerCase();
    const displayName = dto.display_name.trim() || 'کاربر';

    const existing = await this.usersRepo
      .createQueryBuilder('u')
      .where('LOWER(TRIM(u.email)) = :email', { email })
      .getOne();

    if (existing) {
      throw new ConflictException('این ایمیل قبلاً ثبت شده است');
    }

    const telegramUserId = await this.nextWebUserId();
    const passwordHash = await bcrypt.hash(dto.password, 10);

    const user = await this.usersRepo.save({
      telegramUserId,
      firstName: displayName,
      email,
      passwordHash,
      portalLoginEnabled: true,
      appRole: 'user',
      isPremium: false,
      visitCount: 1,
    });

    return this.createSession(user);
  }

  async login(dto: AppLoginDto) {
    const email = dto.email.trim().toLowerCase();

    const user = await this.usersRepo
      .createQueryBuilder('u')
      .where('LOWER(TRIM(u.email)) = :email', { email })
      .andWhere('u.portal_login_enabled = true')
      .andWhere('u.password_hash IS NOT NULL')
      .andWhere('u.is_banned = false')
      .getOne();

    if (!user?.passwordHash) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    const valid = await bcrypt.compare(dto.password, user.passwordHash);
    if (!valid) {
      throw new UnauthorizedException('ایمیل یا رمز عبور اشتباه است');
    }

    user.lastSeenAt = new Date();
    user.visitCount = (user.visitCount ?? 0) + 1;
    await this.usersRepo.save(user);

    await this.sessionsRepo
      .createQueryBuilder()
      .delete()
      .where('telegram_user_id = :id', { id: user.telegramUserId })
      .andWhere('expires_at < :now', { now: new Date() })
      .execute();

    return this.createSession(user);
  }

  async logout(token: string): Promise<void> {
    if (!token) return;
    await this.sessionsRepo.delete({ token });
  }

  async verifySession(token: string) {
    if (!token) return null;

    const session = await this.sessionsRepo.findOne({ where: { token } });
    if (!session || session.expiresAt.getTime() <= Date.now()) {
      if (session) await this.sessionsRepo.delete({ token });
      return null;
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId: session.telegramUserId },
    });

    if (!user || user.isBanned || !user.portalLoginEnabled) {
      await this.sessionsRepo.delete({ token });
      return null;
    }

    return {
      ok: true,
      user_id: Number(user.telegramUserId),
      display_name: user.firstName?.trim() || user.email || 'کاربر',
      email: user.email,
      expires_at: session.expiresAt.toISOString(),
      auth_method: 'web' as const,
      can_link_telegram: this.isWebUserId(user.telegramUserId),
    };
  }

  async startTelegramLink(sessionToken: string, dto: LinkTelegramStartDto) {
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw new UnauthorizedException('نشست وب یافت نشد');
    }
    if (!session.can_link_telegram) {
      throw new BadRequestException('این حساب قابل اتصال به Telegram نیست');
    }

    const token = randomUUID();
    const expiresAt = new Date(Date.now() + LINK_TOKEN_TTL_MS);

    await this.linkTokensRepo.save({
      token,
      webUserId: String(session.user_id),
      expiresAt,
    });

    const botUsername = String(
      dto.bot_username?.trim() ||
        this.config.get<string>('telegram.miniAppBotUsername') ||
        this.config.get<string>('telegram.botUsername') ||
        'ShioriMiniBot',
    ).replace(/^@+/, '');

    const telegramUrl = `https://t.me/${botUsername}?startapp=link_${token}`;

    return {
      ok: true,
      token,
      telegram_url: telegramUrl,
      expires_at: expiresAt.toISOString(),
    };
  }

  async getTelegramLinkStatus(tokenRaw: string): Promise<{
    status: LinkTelegramStatus;
  }> {
    const token = String(tokenRaw ?? '').trim();
    if (!token) return { status: 'invalid' };

    const row = await this.linkTokensRepo.findOne({ where: { token } });
    if (!row) return { status: 'invalid' };
    if (row.completedAt) return { status: 'completed' };
    if (row.expiresAt.getTime() <= Date.now()) return { status: 'expired' };
    return { status: 'pending' };
  }

  async completeTelegramLink(
    initDataHeader: string | string[] | undefined,
    dto: CompleteTelegramLinkDto,
  ) {
    const telegramUserId = String(this.resolveTelegramUserId(initDataHeader));
    const linkToken = await this.linkTokensRepo.findOne({
      where: { token: dto.token },
    });

    if (!linkToken) {
      throw new NotFoundException('لینک اتصال نامعتبر است');
    }
    if (linkToken.completedAt) {
      return {
        ok: true,
        already_completed: true,
        telegram_user_id: Number(linkToken.telegramUserId),
      };
    }
    if (linkToken.expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException(
        'لینک اتصال منقضی شده — دوباره از پروفایل وب درخواست دهید',
      );
    }

    await this.mergeWebUserIntoTelegram(linkToken.webUserId, telegramUserId);

    linkToken.completedAt = new Date();
    linkToken.telegramUserId = telegramUserId;
    await this.linkTokensRepo.save(linkToken);

    return {
      ok: true,
      merged: true,
      telegram_user_id: Number(telegramUserId),
      web_user_id: Number(linkToken.webUserId),
    };
  }

  async linkTelegramWithCredentials(
    initDataHeader: string | string[] | undefined,
    dto: LinkTelegramCredentialsDto,
  ) {
    const telegramUserId = String(this.resolveTelegramUserId(initDataHeader));
    const webUser = await this.findWebUserByCredentials(dto);

    await this.mergeWebUserIntoTelegram(webUser.telegramUserId, telegramUserId);

    return {
      ok: true,
      merged: true,
      telegram_user_id: Number(telegramUserId),
      web_user_id: Number(webUser.telegramUserId),
    };
  }
}
