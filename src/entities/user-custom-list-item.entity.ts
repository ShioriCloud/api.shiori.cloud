import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  Unique,
} from 'typeorm';
import { Anime } from './anime.entity';
import { UserCustomList } from './user-custom-list.entity';

@Entity('user_custom_list_items')
@Unique(['listId', 'animeId'])
export class UserCustomListItem {
  @PrimaryGeneratedColumn('increment', { type: 'bigint' })
  id: string;

  @Index('idx_user_custom_list_items_list')
  @Column({ type: 'uuid', name: 'list_id' })
  listId: string;

  @Index('idx_user_custom_list_items_anime')
  @Column({ type: 'uuid', name: 'anime_id' })
  animeId: string;

  @Column({ type: 'int', default: 0 })
  position: number;

  @Column({ type: 'timestamptz', name: 'created_at', default: () => 'now()' })
  createdAt: Date;

  @ManyToOne(() => UserCustomList, (list) => list.items, {
    onDelete: 'CASCADE',
  })
  @JoinColumn({ name: 'list_id' })
  list: UserCustomList;

  @ManyToOne(() => Anime, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'anime_id' })
  anime: Anime;
}
