import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import * as bcrypt from 'bcryptjs';
import { In, Repository } from 'typeorm';
import {
  Anime,
  DownloadTokenLedger,
  SponsorJoinEvent,
  SupportTicket,
  SupportTicketMessage,
  TelegramUser,
  UserAnimeAiringReminder,
  UserAnimeListEntry,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserPortalSession,
} from '../../entities';
import {
  BanTelegramUserDto,
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
  is_banned: boolean;
  banned_at: string | null;
  banned_reason: string | null;
  first_seen_at: string;
  last_seen_at: string;
  visit_count: number;
  favorites_count: number;
  download_token_balance: number;
  subscription_expires_at: string | null;
  subscription_active: boolean;
  is_web_only: boolean;
};

export type TelegramUsersOverview = {
  totalUsers: number;
  activeLast24h: number;
  activeLast7d: number;
  premiumUsers: number;
  adminUsers: number;
};

export type TelegramUserActivityItem = {
  at: string;
  kind: string;
  label: string;
  ref_id?: string | null;
};

export type TelegramUserAdminDetail = {
  user: TelegramUserAdminRow;
  counts: {
    favorites: number;
    custom_lists: number;
    reminders: number;
    open_tickets: number;
    active_sessions: number;
    ledger_entries: number;
  };
  anime_list: Array<{
    anime_id: string;
    title: string;
    cover_image: string | null;
    episodes_watched: number;
    user_rating: number | null;
    created_at: string;
    updated_at: string;
  }>;
  custom_lists: Array<{
    id: string;
    name: string;
    icon: string;
    item_count: number;
    created_at: string;
    updated_at: string;
    items: Array<{
      anime_id: string;
      title: string;
      cover_image: string | null;
      position: number;
      created_at: string;
    }>;
  }>;
  reminders: Array<{
    anime_id: string;
    title: string;
    cover_image: string | null;
    created_at: string;
  }>;
  ledger: Array<{
    id: string;
    delta: number;
    balance_after: number;
    reason: string;
    note: string | null;
    created_at: string;
  }>;
  tickets: Array<{
    id: string;
    category: string;
    subject: string;
    status: string;
    created_at: string;
    updated_at: string;
  }>;
  activity: TelegramUserActivityItem[];
};

const APP_ROLES = new Set(['user', 'moderator', 'admin']);
const ACTIVITY_LIMIT = 50;

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

const toIso = (value: Date | string | null | undefined): string => {
  if (!value) return '';
  if (value instanceof Date) return value.toISOString();
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '' : d.toISOString();
};

const animeTitle = (anime?: Pick<Anime, 'title' | 'titleRomaji'> | null): string =>
  String(anime?.title || anime?.titleRomaji || 'بدون عنوان').trim() || 'بدون عنوان';

@Injectable()
export class TelegramUsersAdminService {
  constructor(
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(UserAnimeListEntry)
    private readonly listRepo: Repository<UserAnimeListEntry>,
    @InjectRepository(UserCustomList)
    private readonly customListsRepo: Repository<UserCustomList>,
    @InjectRepository(UserCustomListItem)
    private readonly customListItemsRepo: Repository<UserCustomListItem>,
    @InjectRepository(UserAnimeAiringReminder)
    private readonly remindersRepo: Repository<UserAnimeAiringReminder>,
    @InjectRepository(DownloadTokenLedger)
    private readonly ledgerRepo: Repository<DownloadTokenLedger>,
    @InjectRepository(SupportTicket)
    private readonly ticketsRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage)
    private readonly ticketMessagesRepo: Repository<SupportTicketMessage>,
    @InjectRepository(UserNotification)
    private readonly notificationsRepo: Repository<UserNotification>,
    @InjectRepository(SponsorJoinEvent)
    private readonly sponsorJoinsRepo: Repository<SponsorJoinEvent>,
    @InjectRepository(UserPortalSession)
    private readonly sessionsRepo: Repository<UserPortalSession>,
  ) {}

  private mapUser(
    user: TelegramUser,
    favoritesCount: number,
  ): TelegramUserAdminRow {
    const idNum = Number(user.telegramUserId);
    return {
      telegram_user_id: idNum,
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
      is_banned: Boolean(user.isBanned),
      banned_at: user.bannedAt ? toIso(user.bannedAt) : null,
      banned_reason: user.bannedReason,
      first_seen_at: toIso(user.firstSeenAt),
      last_seen_at: toIso(user.lastSeenAt),
      visit_count: user.visitCount ?? 0,
      favorites_count: favoritesCount,
      download_token_balance: user.downloadTokenBalance ?? 0,
      subscription_expires_at: user.subscriptionExpiresAt
        ? toIso(user.subscriptionExpiresAt)
        : null,
      subscription_active: Boolean(
        user.subscriptionExpiresAt &&
          user.subscriptionExpiresAt.getTime() > Date.now(),
      ),
      is_web_only: Number.isFinite(idNum) && idNum < 0,
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

      if (/^\d+$/.test(token) || /^-?\d+$/.test(token)) {
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

  async getUserDetail(telegramUserId: string): Promise<TelegramUserAdminDetail> {
    const user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (!user) throw new NotFoundException('user not found');

    const [
      animeList,
      customLists,
      reminders,
      ledger,
      tickets,
      openTickets,
      activeSessions,
      ledgerCount,
      activity,
    ] = await Promise.all([
      this.listRepo.find({
        where: { telegramUserId },
        relations: { anime: true },
        order: { updatedAt: 'DESC' },
        take: 200,
      }),
      this.customListsRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'ASC' },
      }),
      this.remindersRepo.find({
        where: { telegramUserId },
        relations: { anime: true },
        order: { createdAt: 'DESC' },
      }),
      this.ledgerRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 50,
      }),
      this.ticketsRepo.find({
        where: { telegramUserId },
        order: { updatedAt: 'DESC' },
        take: 50,
      }),
      this.ticketsRepo.count({
        where: { telegramUserId, status: In(['open', 'answered']) },
      }),
      this.sessionsRepo
        .createQueryBuilder('s')
        .where('s.telegramUserId = :telegramUserId', { telegramUserId })
        .andWhere('s.expiresAt > NOW()')
        .getCount(),
      this.ledgerRepo.count({ where: { telegramUserId } }),
      this.buildActivity(telegramUserId, user),
    ]);

    const listIds = customLists.map((list) => list.id);
    const customItems =
      listIds.length === 0
        ? []
        : await this.customListItemsRepo.find({
            where: { listId: In(listIds) },
            relations: { anime: true },
            order: { position: 'ASC', createdAt: 'ASC' },
          });

    const itemsByList = new Map<string, UserCustomListItem[]>();
    for (const item of customItems) {
      const bucket = itemsByList.get(item.listId) ?? [];
      bucket.push(item);
      itemsByList.set(item.listId, bucket);
    }

    return {
      user: this.mapUser(user, animeList.length),
      counts: {
        favorites: animeList.length,
        custom_lists: customLists.length,
        reminders: reminders.length,
        open_tickets: openTickets,
        active_sessions: activeSessions,
        ledger_entries: ledgerCount,
      },
      anime_list: animeList.map((entry) => ({
        anime_id: entry.animeId,
        title: animeTitle(entry.anime),
        cover_image: entry.anime?.coverImage ?? null,
        episodes_watched: entry.episodesWatched ?? 0,
        user_rating:
          entry.userRating == null || entry.userRating === ''
            ? null
            : Number(entry.userRating),
        created_at: toIso(entry.createdAt),
        updated_at: toIso(entry.updatedAt),
      })),
      custom_lists: customLists.map((list) => {
        const items = itemsByList.get(list.id) ?? [];
        return {
          id: list.id,
          name: list.name,
          icon: list.icon,
          item_count: items.length,
          created_at: toIso(list.createdAt),
          updated_at: toIso(list.updatedAt),
          items: items.map((item) => ({
            anime_id: item.animeId,
            title: animeTitle(item.anime),
            cover_image: item.anime?.coverImage ?? null,
            position: item.position ?? 0,
            created_at: toIso(item.createdAt),
          })),
        };
      }),
      reminders: reminders.map((row) => ({
        anime_id: row.animeId,
        title: animeTitle(row.anime),
        cover_image: row.anime?.coverImage ?? null,
        created_at: toIso(row.createdAt),
      })),
      ledger: ledger.map((row) => ({
        id: row.id,
        delta: row.delta,
        balance_after: row.balanceAfter,
        reason: row.reason,
        note: row.note,
        created_at: toIso(row.createdAt),
      })),
      tickets: tickets.map((ticket) => ({
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        status: ticket.status,
        created_at: toIso(ticket.createdAt),
        updated_at: toIso(ticket.updatedAt),
      })),
      activity,
    };
  }

  private async buildActivity(
    telegramUserId: string,
    user: TelegramUser,
  ): Promise<TelegramUserActivityItem[]> {
    const [
      listEntries,
      customLists,
      customItems,
      reminders,
      ledger,
      tickets,
      ticketMessages,
      notifications,
      sponsorJoins,
      sessions,
    ] = await Promise.all([
      this.listRepo.find({
        where: { telegramUserId },
        relations: { anime: true },
        order: { updatedAt: 'DESC' },
        take: 30,
      }),
      this.customListsRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.customListItemsRepo
        .createQueryBuilder('i')
        .innerJoinAndSelect('i.list', 'list')
        .leftJoinAndSelect('i.anime', 'anime')
        .where('list.telegramUserId = :telegramUserId', { telegramUserId })
        .orderBy('i.createdAt', 'DESC')
        .take(30)
        .getMany(),
      this.remindersRepo.find({
        where: { telegramUserId },
        relations: { anime: true },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.ledgerRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 30,
      }),
      this.ticketsRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.ticketMessagesRepo
        .createQueryBuilder('m')
        .innerJoin('m.ticket', 't')
        .where('t.telegramUserId = :telegramUserId', { telegramUserId })
        .andWhere('m.authorRole = :role', { role: 'user' })
        .orderBy('m.createdAt', 'DESC')
        .take(20)
        .getMany(),
      this.notificationsRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 20,
      }),
      this.sponsorJoinsRepo.find({
        where: { telegramUserId },
        relations: { campaign: true },
        order: { verifiedAt: 'DESC' },
        take: 20,
      }),
      this.sessionsRepo.find({
        where: { telegramUserId },
        order: { createdAt: 'DESC' },
        take: 10,
      }),
    ]);

    const items: TelegramUserActivityItem[] = [];

    if (user.firstSeenAt) {
      items.push({
        at: toIso(user.firstSeenAt),
        kind: 'first_seen',
        label: 'اولین ورود به اپ',
      });
    }
    if (user.lastSeenAt) {
      items.push({
        at: toIso(user.lastSeenAt),
        kind: 'last_seen',
        label: `آخرین بازدید (مجموع ${user.visitCount ?? 0} بازدید)`,
      });
    }

    for (const entry of listEntries) {
      const title = animeTitle(entry.anime);
      items.push({
        at: toIso(entry.updatedAt),
        kind: 'anime_list_update',
        label: `به‌روزرسانی لیست: ${title}`,
        ref_id: entry.animeId,
      });
      if (
        entry.createdAt &&
        entry.updatedAt &&
        Math.abs(entry.createdAt.getTime() - entry.updatedAt.getTime()) > 1000
      ) {
        items.push({
          at: toIso(entry.createdAt),
          kind: 'anime_list_add',
          label: `افزودن به لیست: ${title}`,
          ref_id: entry.animeId,
        });
      }
    }

    for (const list of customLists) {
      items.push({
        at: toIso(list.createdAt),
        kind: 'custom_list_create',
        label: `ساخت لیست «${list.name}»`,
        ref_id: list.id,
      });
    }

    for (const item of customItems) {
      items.push({
        at: toIso(item.createdAt),
        kind: 'custom_list_item',
        label: `افزودن «${animeTitle(item.anime)}» به «${item.list?.name ?? 'لیست'}»`,
        ref_id: item.animeId,
      });
    }

    for (const row of reminders) {
      items.push({
        at: toIso(row.createdAt),
        kind: 'reminder',
        label: `یادآوری پخش: ${animeTitle(row.anime)}`,
        ref_id: row.animeId,
      });
    }

    for (const row of ledger) {
      const sign = row.delta >= 0 ? '+' : '';
      items.push({
        at: toIso(row.createdAt),
        kind: 'token_ledger',
        label: `توکن ${sign}${row.delta} (${row.reason})`,
        ref_id: row.id,
      });
    }

    for (const ticket of tickets) {
      items.push({
        at: toIso(ticket.createdAt),
        kind: 'ticket_create',
        label: `تیکت: ${ticket.subject}`,
        ref_id: ticket.id,
      });
    }

    for (const message of ticketMessages) {
      items.push({
        at: toIso(message.createdAt),
        kind: 'ticket_message',
        label: 'پیام کاربر در تیکت پشتیبانی',
        ref_id: message.ticketId,
      });
    }

    for (const note of notifications) {
      items.push({
        at: toIso(note.createdAt),
        kind: 'notification',
        label: `اعلان: ${note.title}`,
        ref_id: note.id,
      });
    }

    for (const join of sponsorJoins) {
      const title = join.campaign?.title?.trim() || 'کمپین اسپانسر';
      items.push({
        at: toIso(join.verifiedAt),
        kind: 'sponsor_join',
        label: `عضویت اسپانسر: ${title}`,
        ref_id: join.campaignId,
      });
    }

    for (const session of sessions) {
      items.push({
        at: toIso(session.createdAt),
        kind: 'session',
        label: 'صدور سشن ورود',
        ref_id: session.token,
      });
    }

    return items
      .filter((item) => item.at)
      .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
      .slice(0, ACTIVITY_LIMIT);
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

  async banUser(
    telegramUserId: string,
    dto: BanTelegramUserDto,
  ): Promise<{ ok: true; revoked_sessions: number }> {
    const user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (!user) throw new NotFoundException('user not found');

    if (user.appRole === 'admin') {
      throw new ConflictException('cannot ban an admin — demote first');
    }

    user.isBanned = true;
    user.bannedAt = new Date();
    const reason = String(dto.reason ?? '').trim();
    user.bannedReason = reason || null;
    await this.usersRepo.save(user);

    const revoked = await this.sessionsRepo.delete({ telegramUserId });
    return { ok: true, revoked_sessions: revoked.affected ?? 0 };
  }

  async unbanUser(telegramUserId: string): Promise<{ ok: true }> {
    const user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (!user) throw new NotFoundException('user not found');

    user.isBanned = false;
    user.bannedAt = null;
    user.bannedReason = null;
    await this.usersRepo.save(user);
    return { ok: true };
  }

  async revokeSessions(
    telegramUserId: string,
  ): Promise<{ ok: true; revoked_sessions: number }> {
    const user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (!user) throw new NotFoundException('user not found');

    const revoked = await this.sessionsRepo.delete({ telegramUserId });
    return { ok: true, revoked_sessions: revoked.affected ?? 0 };
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
      'is_banned',
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
        u.is_banned,
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
