import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('telegram_link_tokens')
export class TelegramLinkToken {
  @PrimaryColumn('uuid')
  token: string;

  @Column({ type: 'bigint', name: 'web_user_id' })
  webUserId: string;

  @Column({ type: 'timestamptz', name: 'expires_at' })
  expiresAt: Date;

  @Column({ type: 'timestamptz', name: 'completed_at', nullable: true })
  completedAt: Date | null;

  @Column({ type: 'bigint', name: 'telegram_user_id', nullable: true })
  telegramUserId: string | null;
}
