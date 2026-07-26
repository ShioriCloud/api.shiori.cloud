import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  SupportTicket,
  type SupportTicketCategory,
  type SupportTicketStatus,
} from '../../entities/support-ticket.entity';
import { SupportTicketMessage } from '../../entities/support-ticket-message.entity';
import { TelegramUser } from '../../entities/telegram-user.entity';
import {
  CreateSupportTicketDto,
  ReplySupportTicketDto,
  UpdateSupportTicketStatusDto,
} from './support-tickets.dto';

export type SupportTicketMessageItem = {
  id: string;
  author_role: 'user' | 'staff';
  author_telegram_user_id: string;
  body: string;
  created_at: string;
};

export type SupportTicketListItem = {
  id: string;
  category: SupportTicketCategory;
  subject: string;
  status: SupportTicketStatus;
  created_at: string;
  updated_at: string;
  last_message_preview: string | null;
  message_count: number;
};

export type SupportTicketDetail = SupportTicketListItem & {
  messages: SupportTicketMessageItem[];
};

export type SupportTicketAdminListItem = SupportTicketListItem & {
  telegram_user_id: string;
  user_display_name: string;
  user_username: string | null;
};

export type SupportTicketAdminDetail = SupportTicketAdminListItem & {
  messages: SupportTicketMessageItem[];
};

@Injectable()
export class SupportTicketsService {
  constructor(
    @InjectRepository(SupportTicket)
    private readonly ticketRepo: Repository<SupportTicket>,
    @InjectRepository(SupportTicketMessage)
    private readonly messageRepo: Repository<SupportTicketMessage>,
    @InjectRepository(TelegramUser)
    private readonly userRepo: Repository<TelegramUser>,
  ) {}

  async listMine(telegramUserId: string): Promise<SupportTicketListItem[]> {
    const tickets = await this.ticketRepo.find({
      where: { telegramUserId },
      order: { updatedAt: 'DESC' },
    });
    return this.toListItems(tickets);
  }

  async getMine(
    telegramUserId: string,
    ticketId: string,
  ): Promise<SupportTicketDetail> {
    const ticket = await this.requireOwnedTicket(telegramUserId, ticketId);
    const messages = await this.loadMessages(ticket.id);
    const [item] = await this.toListItems([ticket], messages);
    return { ...item, messages: messages.map((m) => this.toMessageItem(m)) };
  }

  async createMine(
    telegramUserId: string,
    body: CreateSupportTicketDto,
  ): Promise<SupportTicketDetail> {
    const subject = body.subject.trim();
    const messageBody = body.body.trim();

    return this.ticketRepo.manager.transaction(async (manager) => {
      const ticket = manager.create(SupportTicket, {
        telegramUserId,
        category: body.category,
        subject,
        status: 'open',
      });
      const savedTicket = await manager.save(ticket);

      const message = manager.create(SupportTicketMessage, {
        ticketId: savedTicket.id,
        authorTelegramUserId: telegramUserId,
        authorRole: 'user',
        body: messageBody,
      });
      const savedMessage = await manager.save(message);

      return {
        id: savedTicket.id,
        category: savedTicket.category,
        subject: savedTicket.subject,
        status: savedTicket.status,
        created_at: savedTicket.createdAt.toISOString(),
        updated_at: savedTicket.updatedAt.toISOString(),
        last_message_preview: this.preview(savedMessage.body),
        message_count: 1,
        messages: [this.toMessageItem(savedMessage)],
      };
    });
  }

  async replyMine(
    telegramUserId: string,
    ticketId: string,
    body: ReplySupportTicketDto,
  ): Promise<SupportTicketDetail> {
    const ticket = await this.requireOwnedTicket(telegramUserId, ticketId);
    if (ticket.status === 'closed') {
      throw new ForbiddenException('این تیکت بسته شده است');
    }

    const message = this.messageRepo.create({
      ticketId: ticket.id,
      authorTelegramUserId: telegramUserId,
      authorRole: 'user',
      body: body.body.trim(),
    });
    await this.messageRepo.save(message);

    ticket.status = 'open';
    ticket.updatedAt = new Date();
    await this.ticketRepo.save(ticket);

    return this.getMine(telegramUserId, ticketId);
  }

  async listAdmin(filters: {
    status?: SupportTicketStatus;
    category?: SupportTicketCategory;
  }): Promise<SupportTicketAdminListItem[]> {
    const where: {
      status?: SupportTicketStatus;
      category?: SupportTicketCategory;
    } = {};
    if (filters.status) where.status = filters.status;
    if (filters.category) where.category = filters.category;

    const tickets = await this.ticketRepo.find({
      where,
      order: { updatedAt: 'DESC' },
      take: 200,
    });

    const list = await this.toListItems(tickets);
    const users = await this.loadUsers(tickets.map((t) => t.telegramUserId));

    return list.map((item, i) => {
      const ticket = tickets[i];
      const user = users.get(String(ticket.telegramUserId));
      return {
        ...item,
        telegram_user_id: String(ticket.telegramUserId),
        user_display_name: this.displayName(user),
        user_username: user?.username ?? null,
      };
    });
  }

  async getAdmin(ticketId: string): Promise<SupportTicketAdminDetail> {
    const ticket = await this.requireTicket(ticketId);
    const messages = await this.loadMessages(ticket.id);
    const [item] = await this.toListItems([ticket], messages);
    const users = await this.loadUsers([ticket.telegramUserId]);
    const user = users.get(String(ticket.telegramUserId));

    return {
      ...item,
      telegram_user_id: String(ticket.telegramUserId),
      user_display_name: this.displayName(user),
      user_username: user?.username ?? null,
      messages: messages.map((m) => this.toMessageItem(m)),
    };
  }

  async replyAdmin(
    staffTelegramUserId: string,
    ticketId: string,
    body: ReplySupportTicketDto,
  ): Promise<SupportTicketAdminDetail> {
    const ticket = await this.requireTicket(ticketId);
    if (ticket.status === 'closed') {
      throw new ForbiddenException('این تیکت بسته شده است');
    }

    const message = this.messageRepo.create({
      ticketId: ticket.id,
      authorTelegramUserId: staffTelegramUserId,
      authorRole: 'staff',
      body: body.body.trim(),
    });
    await this.messageRepo.save(message);

    ticket.status = 'answered';
    ticket.updatedAt = new Date();
    await this.ticketRepo.save(ticket);

    return this.getAdmin(ticketId);
  }

  async updateStatusAdmin(
    ticketId: string,
    body: UpdateSupportTicketStatusDto,
  ): Promise<SupportTicketAdminDetail> {
    const ticket = await this.requireTicket(ticketId);
    ticket.status = body.status;
    ticket.updatedAt = new Date();
    await this.ticketRepo.save(ticket);
    return this.getAdmin(ticketId);
  }

  private async requireTicket(ticketId: string): Promise<SupportTicket> {
    const ticket = await this.ticketRepo.findOne({ where: { id: ticketId } });
    if (!ticket) throw new NotFoundException('تیکت پیدا نشد');
    return ticket;
  }

  private async requireOwnedTicket(
    telegramUserId: string,
    ticketId: string,
  ): Promise<SupportTicket> {
    const ticket = await this.requireTicket(ticketId);
    if (String(ticket.telegramUserId) !== String(telegramUserId)) {
      throw new ForbiddenException('دسترسی غیرمجاز');
    }
    return ticket;
  }

  private async loadMessages(ticketId: string): Promise<SupportTicketMessage[]> {
    return this.messageRepo.find({
      where: { ticketId },
      order: { createdAt: 'ASC' },
    });
  }

  private async loadUsers(
    ids: string[],
  ): Promise<Map<string, TelegramUser>> {
    const unique = [...new Set(ids.map(String))];
    if (unique.length === 0) return new Map();
    const rows = await this.userRepo.find({
      where: { telegramUserId: In(unique) },
    });
    return new Map(rows.map((u) => [String(u.telegramUserId), u]));
  }

  private async toListItems(
    tickets: SupportTicket[],
    knownMessages?: SupportTicketMessage[],
  ): Promise<SupportTicketListItem[]> {
    if (tickets.length === 0) return [];

    let byTicket: Map<string, SupportTicketMessage[]>;
    if (knownMessages) {
      byTicket = new Map([[tickets[0].id, knownMessages]]);
    } else {
      const all = await this.messageRepo.find({
        where: { ticketId: In(tickets.map((t) => t.id)) },
        order: { createdAt: 'ASC' },
      });
      byTicket = new Map();
      for (const m of all) {
        const list = byTicket.get(m.ticketId) ?? [];
        list.push(m);
        byTicket.set(m.ticketId, list);
      }
    }

    return tickets.map((ticket) => {
      const messages = byTicket.get(ticket.id) ?? [];
      const last = messages[messages.length - 1] ?? null;
      return {
        id: ticket.id,
        category: ticket.category,
        subject: ticket.subject,
        status: ticket.status,
        created_at: ticket.createdAt.toISOString(),
        updated_at: ticket.updatedAt.toISOString(),
        last_message_preview: last ? this.preview(last.body) : null,
        message_count: messages.length,
      };
    });
  }

  private toMessageItem(m: SupportTicketMessage): SupportTicketMessageItem {
    return {
      id: m.id,
      author_role: m.authorRole,
      author_telegram_user_id: String(m.authorTelegramUserId),
      body: m.body,
      created_at: m.createdAt.toISOString(),
    };
  }

  private preview(body: string): string {
    const trimmed = body.trim().replace(/\s+/g, ' ');
    return trimmed.length > 120 ? `${trimmed.slice(0, 117)}…` : trimmed;
  }

  private displayName(user: TelegramUser | undefined): string {
    if (!user) return 'کاربر';
    const full = [user.firstName, user.lastName].filter(Boolean).join(' ').trim();
    return full || user.username || 'کاربر';
  }
}
