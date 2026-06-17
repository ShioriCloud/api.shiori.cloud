import { Column, Entity, OneToMany, PrimaryGeneratedColumn } from 'typeorm';
import { FilePackItem } from './file-pack-item.entity';

@Entity('file_packs')
export class FilePack {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', unique: true })
  slug: string;

  @Column({ type: 'text' })
  title: string;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @OneToMany(() => FilePackItem, (item) => item.pack)
  items: FilePackItem[];
}
