import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

export type HomeBlockType = 'curated_slider' | 'cta_banner' | 'cta_card';

export type CuratedSliderConfig = {
  anime_ids?: string[];
};

export type CtaBannerConfig = {
  image_url?: string;
  link_url?: string;
  open_in_new_tab?: boolean;
};

export type CtaCardConfig = {
  /** Linked anime — title/synopsis/media tags resolve from catalog at serve time. */
  anime_id?: string;
  /** Optional poster override; falls back to anime featured/cover. */
  image_url?: string;
  /** Optional link override; falls back to `/anime/{slug|id}`. */
  link_url?: string;
  button_label?: string;
  open_in_new_tab?: boolean;
};

export type HomeBlockConfig =
  | CuratedSliderConfig
  | CtaBannerConfig
  | CtaCardConfig;

@Entity('home_blocks')
export class HomeBlock {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'text' })
  type: HomeBlockType;

  @Column({ type: 'text', nullable: true })
  title: string | null;

  @Column({ type: 'text', nullable: true })
  subtitle: string | null;

  @Column({ type: 'text', nullable: true })
  description: string | null;

  @Column({ type: 'int', name: 'sort_order', default: 0 })
  sortOrder: number;

  @Column({ type: 'boolean', name: 'is_active', default: true })
  isActive: boolean;

  @Column({ type: 'jsonb', default: () => "'{}'" })
  config: HomeBlockConfig;

  @CreateDateColumn({ type: 'timestamptz', name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz', name: 'updated_at' })
  updatedAt: Date;
}
