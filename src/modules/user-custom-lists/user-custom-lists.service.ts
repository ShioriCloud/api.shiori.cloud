import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { Anime, TelegramUser } from '../../entities';
import { isSocialProfileEnabledFor } from '../user-social-profile/social-profile-rollout.util';
import {
  MAX_USER_CUSTOM_LISTS,
  USER_CUSTOM_LIST_ICONS,
  UserCustomList,
  type UserCustomListIcon,
} from '../../entities/user-custom-list.entity';
import { UserCustomListItem } from '../../entities/user-custom-list-item.entity';
import {
  AddUserCustomListItemDto,
  CreateUserCustomListDto,
  ReorderUserCustomListItemsDto,
  UpdateUserCustomListDto,
} from './user-custom-lists.dto';

export type UserCustomListItemDto = {
  anime_id: string;
  position: number;
};

export type UserCustomListDto = {
  id: string;
  name: string;
  icon: UserCustomListIcon;
  is_public: boolean;
  created_at: string;
  updated_at: string;
  items: UserCustomListItemDto[];
};

export type PublicUserCustomListSummary = {
  id: string;
  name: string;
  icon: UserCustomListIcon;
  item_count: number;
  updated_at: string;
};

export type PublicUserCustomListDetail = PublicUserCustomListSummary & {
  items: Array<{
    anime_id: string;
    slug: string | null;
    title: string;
    image: string;
    position: number;
  }>;
};

const normalizeName = (name: string) => name.trim().replace(/\s+/g, ' ');

const isListIcon = (
  value: string | null | undefined,
): value is UserCustomListIcon =>
  Boolean(
    value && (USER_CUSTOM_LIST_ICONS as readonly string[]).includes(value),
  );

@Injectable()
export class UserCustomListsService {
  constructor(
    @InjectRepository(UserCustomList)
    private readonly listRepo: Repository<UserCustomList>,
    @InjectRepository(UserCustomListItem)
    private readonly itemRepo: Repository<UserCustomListItem>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
  ) {}

  private isSocialEnabledFor(telegramUserId: string): boolean {
    return isSocialProfileEnabledFor(telegramUserId);
  }

  async list(telegramUserId: string): Promise<{ lists: UserCustomListDto[] }> {
    const rows = await this.listRepo.find({
      where: { telegramUserId },
      relations: { items: true },
      order: { createdAt: 'ASC' },
    });

    return { lists: rows.map((row) => this.toDto(row)) };
  }

  async create(
    telegramUserId: string,
    body: CreateUserCustomListDto,
  ): Promise<UserCustomListDto> {
    const name = normalizeName(body.name);
    if (!name) {
      throw new BadRequestException('list name is required');
    }

    if (body.id) {
      const existing = await this.listRepo.findOne({
        where: { id: body.id },
        relations: { items: true },
      });
      if (existing) {
        if (existing.telegramUserId !== telegramUserId) {
          throw new BadRequestException('list id is already in use');
        }
        return this.toDto(existing);
      }
    }

    const count = await this.listRepo.count({ where: { telegramUserId } });
    if (count >= MAX_USER_CUSTOM_LISTS) {
      throw new BadRequestException(
        `at most ${MAX_USER_CUSTOM_LISTS} custom lists are allowed`,
      );
    }

    const list = this.listRepo.create({
      ...(body.id ? { id: body.id } : {}),
      telegramUserId,
      name,
      icon: body.icon ?? 'heart',
      isPublic: body.is_public === true,
    });
    await this.listRepo.save(list);
    list.items = [];
    return this.toDto(list);
  }

  async update(
    telegramUserId: string,
    listId: string,
    body: UpdateUserCustomListDto,
  ): Promise<UserCustomListDto> {
    const list = await this.requireList(telegramUserId, listId);
    if (body.name !== undefined) {
      const name = normalizeName(body.name);
      if (!name) {
        throw new BadRequestException('list name is required');
      }
      list.name = name;
    }
    if (body.icon !== undefined) {
      list.icon = body.icon;
    }
    if (body.is_public !== undefined) {
      list.isPublic = body.is_public;
    }
    list.updatedAt = new Date();
    await this.listRepo.save(list);
    return this.toDto(list);
  }

  async remove(telegramUserId: string, listId: string) {
    const list = await this.requireList(telegramUserId, listId);
    await this.listRepo.delete({ id: list.id });
    return { ok: true as const };
  }

  async addItem(
    telegramUserId: string,
    listId: string,
    body: AddUserCustomListItemDto,
  ): Promise<UserCustomListDto> {
    const list = await this.requireList(telegramUserId, listId);
    const animeId = body.anime_id.trim();
    await this.requireAnime(animeId);

    const already = (list.items ?? []).some((item) => item.animeId === animeId);
    if (already) {
      return this.toDto(list);
    }

    const nextPosition =
      (list.items ?? []).reduce(
        (max, item) => Math.max(max, item.position),
        -1,
      ) + 1;

    await this.itemRepo.save(
      this.itemRepo.create({
        listId: list.id,
        animeId,
        position: nextPosition,
      }),
    );
    await this.touchList(list.id);
    return this.getListDto(telegramUserId, list.id);
  }

  async removeItem(
    telegramUserId: string,
    listId: string,
    animeId: string,
  ): Promise<UserCustomListDto> {
    const list = await this.requireList(telegramUserId, listId);
    const result = await this.itemRepo.delete({
      listId: list.id,
      animeId: animeId.trim(),
    });
    if (!result.affected) {
      throw new NotFoundException('list item not found');
    }
    await this.compactPositions(list.id);
    await this.touchList(list.id);
    return this.getListDto(telegramUserId, list.id);
  }

  async reorderItems(
    telegramUserId: string,
    listId: string,
    body: ReorderUserCustomListItemsDto,
  ): Promise<UserCustomListDto> {
    const list = await this.requireList(telegramUserId, listId);
    const current = new Map(
      (list.items ?? []).map((item) => [item.animeId, item]),
    );
    const seen = new Set<string>();
    let position = 0;

    for (const rawId of body.anime_ids) {
      const animeId = rawId.trim();
      const item = current.get(animeId);
      if (!item || seen.has(animeId)) continue;
      item.position = position;
      seen.add(animeId);
      position += 1;
    }

    for (const item of list.items ?? []) {
      if (seen.has(item.animeId)) continue;
      item.position = position;
      position += 1;
    }

    if (list.items?.length) {
      await this.itemRepo.save(list.items);
    }
    await this.touchList(list.id);
    return this.getListDto(telegramUserId, list.id);
  }

  async listPublicForUser(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
  ): Promise<{ enabled: boolean; lists: PublicUserCustomListSummary[] }> {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    const enabled = this.isSocialEnabledFor(viewerId);
    if (!enabled) {
      return { enabled: false, lists: [] };
    }

    const target = await this.usersRepo.findOne({
      where: { telegramUserId: targetId },
    });
    if (!target) {
      throw new NotFoundException('User not found');
    }

    const rows = await this.listRepo.find({
      where: { telegramUserId: targetId, isPublic: true },
      relations: { items: true },
      order: { updatedAt: 'DESC' },
    });

    return {
      enabled: true,
      lists: rows.map((row) => ({
        id: row.id,
        name: row.name,
        icon: isListIcon(row.icon) ? row.icon : 'heart',
        item_count: row.items?.length ?? 0,
        updated_at: row.updatedAt.toISOString(),
      })),
    };
  }

  async getPublicList(
    viewerTelegramUserId: string,
    targetTelegramUserId: string,
    listId: string,
  ): Promise<{ enabled: boolean; list: PublicUserCustomListDetail | null }> {
    const viewerId = String(viewerTelegramUserId).trim();
    const targetId = String(targetTelegramUserId).trim();
    const enabled = this.isSocialEnabledFor(viewerId);
    if (!enabled) {
      return { enabled: false, list: null };
    }

    const list = await this.listRepo.findOne({
      where: { id: listId, telegramUserId: targetId, isPublic: true },
      relations: { items: true },
    });
    if (!list) {
      throw new NotFoundException('public list not found');
    }

    const items = [...(list.items ?? [])].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });
    const animeIds = items.map((item) => item.animeId);
    const animes =
      animeIds.length > 0
        ? await this.animeRepo.find({ where: { id: In(animeIds) } })
        : [];
    const animeById = new Map(animes.map((a) => [a.id, a]));

    return {
      enabled: true,
      list: {
        id: list.id,
        name: list.name,
        icon: isListIcon(list.icon) ? list.icon : 'heart',
        item_count: items.length,
        updated_at: list.updatedAt.toISOString(),
        items: items
          .map((item) => {
            const anime = animeById.get(item.animeId);
            if (!anime) return null;
            return {
              anime_id: item.animeId,
              slug: anime.slug ?? null,
              title: anime.title ?? '—',
              image: anime.coverImage || anime.featuredImage || '',
              position: item.position,
            };
          })
          .filter((x): x is NonNullable<typeof x> => x != null),
      },
    };
  }

  private async requireList(
    telegramUserId: string,
    listId: string,
  ): Promise<UserCustomList> {
    const list = await this.listRepo.findOne({
      where: { id: listId, telegramUserId },
      relations: { items: true },
    });
    if (!list) {
      throw new NotFoundException('custom list not found');
    }
    return list;
  }

  private async requireAnime(animeId: string) {
    const anime = await this.animeRepo.findOne({ where: { id: animeId } });
    if (!anime) {
      throw new BadRequestException('anime not found');
    }
  }

  private async getListDto(telegramUserId: string, listId: string) {
    const list = await this.requireList(telegramUserId, listId);
    return this.toDto(list);
  }

  private async touchList(listId: string) {
    await this.listRepo.update({ id: listId }, { updatedAt: new Date() });
  }

  private async compactPositions(listId: string) {
    const items = await this.itemRepo.find({
      where: { listId },
      order: { position: 'ASC', createdAt: 'ASC' },
    });
    items.forEach((item, index) => {
      item.position = index;
    });
    if (items.length) {
      await this.itemRepo.save(items);
    }
  }

  private toDto(list: UserCustomList): UserCustomListDto {
    const items = [...(list.items ?? [])].sort((a, b) => {
      if (a.position !== b.position) return a.position - b.position;
      return a.createdAt.getTime() - b.createdAt.getTime();
    });

    return {
      id: list.id,
      name: list.name,
      icon: isListIcon(list.icon) ? list.icon : 'heart',
      is_public: list.isPublic === true,
      created_at: list.createdAt.toISOString(),
      updated_at: list.updatedAt.toISOString(),
      items: items.map((item) => ({
        anime_id: item.animeId,
        position: item.position,
      })),
    };
  }
}
