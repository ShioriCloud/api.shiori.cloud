import { Column, Entity, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { BotFile } from './bot-file.entity';
import { FilePack } from './file-pack.entity';

@Entity('file_pack_items')
export class FilePackItem {
  @PrimaryColumn({ type: 'uuid', name: 'pack_id' })
  packId: string;

  @PrimaryColumn({ type: 'text', name: 'file_key' })
  fileKey: string;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => FilePack, (pack) => pack.items, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'pack_id' })
  pack: FilePack;

  @ManyToOne(() => BotFile, (file) => file.packItems, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'file_key' })
  file: BotFile;
}
