import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('download_token_ledger')
export class DownloadTokenLedger {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'int' })
  delta: number;

  @Column({ type: 'int', name: 'balance_after' })
  balanceAfter: number;

  /** signup_grant | free_download | donation_credit | admin_grant */
  @Column({ type: 'text' })
  reason: string;

  @Column({ type: 'text', name: 'ref_type', nullable: true })
  refType: string | null;

  @Column({ type: 'text', name: 'ref_id', nullable: true })
  refId: string | null;

  @Column({ type: 'text', nullable: true })
  note: string | null;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;
}
