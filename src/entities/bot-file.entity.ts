import { Column, Entity, OneToMany, PrimaryColumn } from 'typeorm';
import { FilePackItem } from './file-pack-item.entity';

@Entity('files')
export class BotFile {
  @PrimaryColumn({ type: 'text' })
  key: string;

  @Column({ type: 'bigint', name: 'message_id', nullable: true })
  messageId: string | null;

  @Column({ type: 'text', nullable: true })
  type: string | null;

  @Column({ type: 'text', name: 'file_id', nullable: true })
  fileId: string | null;

  @Column({ type: 'text', name: 'file_name', nullable: true })
  fileName: string | null;

  @Column({ type: 'text', nullable: true })
  caption: string | null;

  @Column({ type: 'bigint', name: 'file_size', nullable: true })
  fileSize: string | null;

  @Column({ type: 'int', default: 0 })
  downloads: number;

  @Column({ type: 'timestamptz', name: 'last_accessed', nullable: true })
  lastAccessed: Date | null;

  @Column({ type: 'timestamptz', name: 'created_at', nullable: true })
  createdAt: Date | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @OneToMany(() => FilePackItem, (item) => item.file)
  packItems: FilePackItem[];
}
