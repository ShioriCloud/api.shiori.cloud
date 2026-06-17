import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

@Entity('media_assets')
export class MediaAsset {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text', name: 'file_name' })
  fileName: string;

  @Column({ type: 'text', name: 'original_name', nullable: true })
  originalName: string | null;

  @Column({ type: 'text' })
  mimetype: string;

  @Column({ type: 'text' })
  url: string;

  @Column({ type: 'text', name: 'storage_path' })
  storagePath: string;

  @Column({ type: 'bigint', nullable: true })
  size: string | null;

  @Column({ type: 'text', name: 'alt_text', nullable: true })
  altText: string | null;

  @Column({ type: 'text', nullable: true })
  caption: string | null;

  @Column({ type: 'bigint', name: 'uploaded_by', nullable: true })
  uploadedBy: string | null;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
