import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { Repository } from 'typeorm';
import { TelegramUser, UserAnimeListEntry } from '../../entities';
import {
  ListTelegramUsersQueryDto,
  UpdateTelegramUserAdminDto,
} from './telegram-users-admin.dto';

export type TelegramUserAdminRow = {
  telegram_user_id: number;
  first_name: string;
  last_name: string | null;
  username: string | null;
  email: string | null;
  language_code: string | null;
  photo_url: string | null;
  is_premium: boolean;
  app_role: string;
  admin_notes: string | null;
  portal_login_enabled: boolean;
  has_portal_password: boolean;
  first_seen_at: string;
  last_seen_at: string;
  visit_count: number;
  favorites_count: number;
};

export type TelegramUsersOverview = {
  totalUsers: number;
  activeLast24h: number;
  activeLast7d: number;
  premiumUsers: number;
  adminUsers: number;
};

const APP_ROLES = new Set(['user', 'moderator', 'admin']);

const splitSearchTokens = (query?: string): string[] =>
  String(query ?? '')
    .trim()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length > 0);

const cleanUsername = (value?: string | null): string | null => {
  const trimmed = String(value ?? '')
    .trim()
    .replace(/^@+/, '');
  return trimmed || null;
};

@Injectable()
export class TelegramUsersAdminService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
  ) {}

  private mapUser(
    user: TelegramUser,
    favoritesCount: number,
  ): TelegramUserAdminRow {
    return {
      telegram_user_id: Number(user.telegramUserId),
      first_name: user.firstName ?? '',
      last_name: user.lastName,
      username: user.username,
      email: user.email,
      language_code: user.languageCode,
      photo_url: user.photoUrl,
      is_premium: Boolean(user.isPremium),
      app_role: user.appRole ?? 'user',
      admin_notes: user.adminNotes,
      portal_login_enabled: user.portalLoginEnabled !== false,
      has_portal_password: Boolean(user.passwordHash),
      first_seen_at: user.firstSeenAt?.toISOString?.() ?? '',
      last_seen_at: user.lastSeenAt?.toISOString?.() ?? '',
      visit_count: user.visitCount ?? 0,
      favorites_count: favoritesCount,
    };
  }

  private async loadFavoritesCounts(
    userIds: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    if (userIds.length === 0) return map;

    const rows = await this.listRepo
      .createQueryBuilder('l')
      .select('l.telegramUserId', 'telegram_user_id')
      .addSelect('COUNT(*)', 'favorites_count')
      .where('l.telegramUserId IN (:...userIds)', { userIds })
      .groupBy('l.telegramUserId')
      .getRawMany<{ telegram_user_id: string; favorites_count: string }>();

    for (const row of rows) {
      map.set(String(row.telegram_user_id), Number(row.favorites_count) || 0);
    }
    return map;
  }

  private applyListFilters(
    qb: ReturnType<Repository<TelegramUser>['createQueryBuilder']>,
    query: ListTelegramUsersQueryDto,
  ) {
    if (query.roleFilter && query.roleFilter !== 'all') {
      qb.andWhere('u.appRole = :roleFilter', { roleFilter: query.roleFilter });
    }

    if (query.usernameFilter === 'with') {
      qb.andWhere('u.username IS NOT NULL');
    } else if (query.usernameFilter === 'without') {
      qb.andWhere('u.username IS NULL');
    }

    const tokens = splitSearchTokens(query.search);
    tokens.forEach((token, index) => {
      const likeKey = `searchLike${index}`;
      const usernameKey = `searchUsernameLike${index}`;
      const idKey = `searchId${index}`;
      const like = `%${token.replace(/([%_\\])/g, '\\$1')}%`;
      const usernameToken = token.startsWith('@') ? token.slice(1) : token;
      const usernameLike = `%${usernameToken.replace(/([%_\\])/g, '\\$1')}%`;

      if (/^\d+$/.test(token)) {
        qb.andWhere(
          `(u.firstName ILIKE :${likeKey} OR u.lastName ILIKE :${likeKey} OR u.username ILIKE :${likeKey} OR u.telegramUserId = :${idKey})`,
          { [likeKey]: like, [idKey]: token },
        );
      } else {
        qb.andWhere(
          `(u.firstName ILIKE :${likeKey} OR u.lastName ILIKE :${likeKey} OR u.username ILIKE :${usernameKey})`,
          { [likeKey]: like, [usernameKey]: usernameLike },
        );
      }
    });
  }

  private sortColumn(sortBy: ListTelegramUsersQueryDto['sortBy']): string {
    switch (sortBy) {
      case 'first_seen_at':
        return 'u.firstSeenAt';
      case 'visit_count':
        return 'u.visitCount';
      case 'first_name':
        return 'u.firstName';
      case 'username':
        return 'u.username';
      case 'app_role':
        return 'u.appRole';
      case 'favorites_count':
        return 'favorites_count';
      case 'last_seen_at':
      default:
        return 'u.lastSeenAt';
    }
  }

  async getOverview(): Promise<TelegramUsersOverview> {
    const now = Date.now();
    const dayAgo = new Date(now - 24 * 60 * 60 * 1000);
    const weekAgo = new Date(now - 7 * 24 * 60 * 60 * 1000);

    const raw = await this.usersRepo
      .createQueryBuilder('u')
      .select('COUNT(*)', 'totalUsers')
      .addSelect(
        'SUM(CASE WHEN u.lastSeenAt >= :dayAgo THEN 1 ELSE 0 END)',
        'activeLast24h',
      )
      .addSelect(
        'SUM(CASE WHEN u.lastSeenAt >= :weekAgo THEN 1 ELSE 0 END)',
        'activeLast7d',
      )
      .addSelect(
        'SUM(CASE WHEN u.isPremium = true THEN 1 ELSE 0 END)',
        'premiumUsers',
      )
      .addSelect(
        "SUM(CASE WHEN u.appRole = 'admin' THEN 1 ELSE 0 END)",
        'adminUsers',
      )
      .setParameters({ dayAgo, weekAgo })
      .getRawOne<Record<string, string>>();

    return {
      totalUsers: Number(raw?.totalUsers) || 0,
      activeLast24h: Number(raw?.activeLast24h) || 0,
      activeLast7d: Number(raw?.activeLast7d) || 0,
      premiumUsers: Number(raw?.premiumUsers) || 0,
      adminUsers: Number(raw?.adminUsers) || 0,
    };
  }

  async listUsers(
    query: ListTelegramUsersQueryDto,
  ): Promise<{ items: TelegramUserAdminRow[]; total: number }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const sortBy = query.sortBy ?? 'last_seen_at';
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const baseQb = this.usersRepo.createQueryBuilder('u');
    this.applyListFilters(baseQb, query);

    const total = await baseQb.clone().getCount();

    if (sortBy === 'favorites_count') {
      const qb = baseQb
        .leftJoin(
          '(SELECT telegram_user_id, COUNT(*)::int AS favorites_count FROM user_anime_list GROUP BY telegram_user_id)',
          'fav',
          'fav.telegram_user_id = u.telegram_user_id',
        )
        .addSelect('COALESCE(fav.favorites_count, 0)', 'favorites_count')
        .orderBy('favorites_count', sortDir)
        .addOrderBy('u.telegramUserId', 'ASC')
        .skip((page - 1) * limit)
        .take(limit);

      const { entities, raw } = await qb.getRawAndEntities();
      const favMap = new Map<string, number>();
      raw.forEach((row, index) => {
        const id = entities[index]?.telegramUserId;
        if (id) favMap.set(id, Number(row.favorites_count) || 0);
      });

      return {
        items: entities.map((user) =>
          this.mapUser(user, favMap.get(user.telegramUserId) ?? 0),
        ),
        total,
      };
    }

    const users = await baseQb
      .orderBy(this.sortColumn(sortBy), sortDir, 'NULLS LAST')
      .addOrderBy('u.telegramUserId', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const favMap = await this.loadFavoritesCounts(
      users.map((u) => u.telegramUserId),
    );

    return {
      items: users.map((user) =>
        this.mapUser(user, favMap.get(user.telegramUserId) ?? 0),
      ),
      total,
    };
  }

  async updateUser(
    telegramUserId: string,
    dto: UpdateTelegramUserAdminDto,
  ): Promise<void> {
    if (!APP_ROLES.has(dto.app_role)) {
      throw new BadRequestException('invalid app_role');
    }

    const user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (!user) {
      throw new NotFoundException('user not found');
    }

    if (user.appRole === 'admin' && dto.app_role !== 'admin') {
      const adminCount = await this.usersRepo.count({
        where: { appRole: 'admin' },
      });
      if (adminCount <= 1) {
        throw new ConflictException('cannot demote last admin');
      }
    }

    if (dto.email !== undefined && dto.email !== null) {
      const email = String(dto.email).trim().toLowerCase();
      const normalized = email || null;
      if (normalized) {
        const duplicate = await this.usersRepo
          .createQueryBuilder('u')
          .where('LOWER(TRIM(u.email)) = :email', { email: normalized })
          .andWhere('u.telegramUserId <> :id', { id: telegramUserId })
          .getOne();
        if (duplicate) {
          throw new ConflictException('email already in use');
        }
      }
      user.email = normalized;
    }

    user.appRole = dto.app_role;

    if (dto.admin_notes !== undefined) {
      const notes = String(dto.admin_notes ?? '').trim();
      user.adminNotes = notes || null;
    }

    if (dto.username !== undefined && dto.username !== null) {
      user.username = cleanUsername(dto.username);
    }

    if (dto.portal_login_enabled !== undefined) {
      user.portalLoginEnabled = Boolean(dto.portal_login_enabled);
    }

    if (dto.password !== undefined && dto.password !== null) {
      const password = String(dto.password).trim();
      if (password) {
        user.passwordHash = await bcrypt.hash(password, 10);
      }
    }

    await this.usersRepo.save(user);
  }

  async exportCsv(query: ListTelegramUsersQueryDto): Promise<string> {
    const { items } = await this.listUsers({
      ...query,
      page: 1,
      limit: 5000,
    });

    const escapeCsvCell = (
      value: string | number | boolean | null | undefined,
    ): string => {
      const raw = value == null ? '' : String(value);
      if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
      return raw;
    };

    const header = [
      'telegram_user_id',
      'first_name',
      'last_name',
      'username',
      'app_role',
      'is_premium',
      'visit_count',
      'favorites_count',
      'first_seen_at',
      'last_seen_at',
      'language_code',
      'admin_notes',
    ];

    const rows = items.map((u) =>
      [
        u.telegram_user_id,
        u.first_name,
        u.last_name,
        u.username,
        u.app_role,
        u.is_premium,
        u.visit_count,
        u.favorites_count,
        u.first_seen_at,
        u.last_seen_at,
        u.language_code,
        u.admin_notes,
      ]
        .map(escapeCsvCell)
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${rows.join('\n')}`;
  }
}
