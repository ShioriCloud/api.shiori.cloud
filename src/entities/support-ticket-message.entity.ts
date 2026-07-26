import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportTicket } from './support-ticket.entity';

export type SupportTicketAuthorRole = 'user' | 'staff';

@Entity('support_ticket_messages')
export class SupportTicketMessage {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_support_ticket_messages_ticket')
  @Column({ type: 'uuid', name: 'ticket_id' })
  ticketId: string;

  @Column({ type: 'bigint', name: 'author_telegram_user_id' })
  authorTelegramUserId: string;

  @Column({ type: 'text', name: 'author_role' })
  authorRole: SupportTicketAuthorRole;

  @Column({ type: 'text' })
  body: string;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => SupportTicket, (t) => t.messages, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticket_id' })
  ticket: SupportTicket;
}
