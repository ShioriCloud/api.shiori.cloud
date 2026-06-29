import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('bot_settings')
export class BotSetting {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'text' })
  value: string;

  @Column({ type: 'timestamptz', name: 'updated_at', default: () => 'now()' })
  updatedAt: Date;
}
