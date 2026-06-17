import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('user_portal_sessions')
export class UserPortalSession {
  @PrimaryColumn({ type: 'uuid' })
  token: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
