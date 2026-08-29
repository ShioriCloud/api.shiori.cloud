import {
  Column,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { SupportTicketMessage } from './support-ticket-message.entity';

export type SupportTicketCategory =
  | 'bug_report'
  | 'app_improvement'
  | 'feature_request'
  | 'translation_request'
  | 'account_issue'
  | 'other';

export type SupportTicketStatus = 'open' | 'answered' | 'closed';

@Entity('support_tickets')
export class SupportTicket {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Index('idx_support_tickets_telegram_user')
  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'text' })
  category: SupportTicketCategory;

  @Column({ type: 'text' })
  subject: string;

  @Column({ type: 'text', default: 'open' })
  status: SupportTicketStatus;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;

  @OneToMany(() => SupportTicketMessage, (m) => m.ticket)
  messages: SupportTicketMessage[];
}
