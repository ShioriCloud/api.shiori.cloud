import {
  Column,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from 'typeorm';

export type AdminAuditAction =
  | 'change_role'
  | 'ban'
  | 'unban'
  | 'revoke_sessions'
  | 'portal_password_set'
  | 'portal_login_toggle'
  | 'grant_tokens'
  | 'grant_subscription';

@Entity('admin_audit_events')
@Index('idx_admin_audit_target_created', ['targetTelegramUserId', 'createdAt'])
@Index('idx_admin_audit_actor_created', ['actorTelegramUserId', 'createdAt'])
export class AdminAuditEvent {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', name: 'actor_telegram_user_id' })
  actorTelegramUserId: string;

  @Column({ type: 'text' })
  action: AdminAuditAction;

  @Column({ type: 'bigint', name: 'target_telegram_user_id' })
  targetTelegramUserId: string;

  @Column({ type: 'jsonb', nullable: true })
  meta: Record<string, unknown> | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
