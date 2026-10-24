import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  HomeBlock,
  HomeBlockType,
  SystemRailConfig,
} from '../../entities/home-block.entity';
import {
  CreateHomeBlockDto,
  ReorderHomeBlocksDto,
  UpdateHomeBlockDto,
} from './home-admin.dto';
import {
  normalizeConfig,
  SYSTEM_RAIL_LABELS,
  SYSTEM_RAIL_SEED,
  validateBlockPayload,
} from './home-block.util';

export type HomeBlockAdminItem = {
  id: string;
  type: HomeBlockType;
  title: string | null;
  subtitle: string | null;
  description: string | null;
  sort_order: number;
  is_active: boolean;
  config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class HomeAdminService {
  constructor(
    @InjectRepository(HomeBlock)
    private readonly blockRepo: Repository<HomeBlock>,
  ) {}

  async listBlocks(): Promise<HomeBlockAdminItem[]> {
    await this.ensureSystemRails();
    const rows = await this.blockRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.toAdminItem(row));
  }

  async getBlock(id: string): Promise<HomeBlockAdminItem> {
    const row = await this.blockRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Home block not found');
    return this.toAdminItem(row);
  }

  async createBlock(body: CreateHomeBlockDto): Promise<HomeBlockAdminItem> {
    if (body.type === 'system_rail') {
      throw new BadRequestException(
        'ریل‌های اصلی از قبل وجود دارند و قابل ایجاد نیستند',
      );
    }
    validateBlockPayload(body.type, body.title, body.config);

    return this.blockRepo.manager.transaction(async (manager) => {
      const maxSort = await manager
        .createQueryBuilder(HomeBlock, 'b')
        .select('COALESCE(MAX(b.sortOrder), 0)', 'max')
        .getRawOne<{ max: string }>();

      const sortOrder = Number.parseInt(maxSort?.max ?? '0', 10) + 1;

      const row = manager.create(HomeBlock, {
        type: body.type,
        title: body.title?.trim() || null,
        subtitle: body.subtitle?.trim() || null,
        description: body.description?.trim() || null,
        isActive: body.is_active ?? true,
        sortOrder,
        config: normalizeConfig(body.type, body.config),
      });

      const saved = await manager.save(row);
      return this.toAdminItem(saved);
    });
  }

  async updateBlock(
    id: string,
    body: UpdateHomeBlockDto,
  ): Promise<HomeBlockAdminItem> {
    const row = await this.blockRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Home block not found');

    if (row.type === 'system_rail') {
      if (body.type !== undefined && body.type !== 'system_rail') {
        throw new BadRequestException('نوع ریل اصلی قابل تغییر نیست');
      }

      if (body.title !== undefined) row.title = body.title?.trim() || null;
      if (body.is_active !== undefined) row.isActive = body.is_active;
      // Keep rail_id immutable; ignore subtitle/description/config mutations.
      const saved = await this.blockRepo.save(row);
      return this.toAdminItem(saved);
    }

    if (body.type === 'system_rail') {
      throw new BadRequestException('نمی‌توان بلاک را به ریل اصلی تبدیل کرد');
    }

    const nextType = body.type ?? row.type;
    const nextTitle = body.title !== undefined ? body.title : row.title;
    const typeChanged = body.type !== undefined && body.type !== row.type;
    const nextConfig = normalizeConfig(
      nextType,
      (body.config ?? row.config) as Record<string, unknown>,
    );

    validateBlockPayload(nextType, nextTitle, nextConfig);

    if (body.type !== undefined) row.type = body.type;
    if (body.title !== undefined) row.title = body.title?.trim() || null;
    if (body.subtitle !== undefined)
      row.subtitle = body.subtitle?.trim() || null;
    if (body.description !== undefined) {
      row.description = body.description?.trim() || null;
    }
    if (body.is_active !== undefined) row.isActive = body.is_active;
    if (body.config !== undefined || typeChanged) row.config = nextConfig;

    const saved = await this.blockRepo.save(row);
    return this.toAdminItem(saved);
  }

  async reorderBlocks(
    body: ReorderHomeBlocksDto,
  ): Promise<HomeBlockAdminItem[]> {
    await this.ensureSystemRails();
    const ids = body.ordered_ids;
    const rows = await this.blockRepo.find();

    if (ids.length !== rows.length) {
      throw new BadRequestException('ordered_ids must include every block');
    }

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('ordered_ids must not contain duplicates');
    }

    const known = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!known.has(id)) {
        throw new BadRequestException(`Unknown block id: ${id}`);
      }
    }

    await this.blockRepo.manager.transaction(async (manager) => {
      for (let index = 0; index < ids.length; index += 1) {
        await manager.update(
          HomeBlock,
          { id: ids[index] },
          { sortOrder: index + 1 },
        );
      }
    });

    return this.listBlocks();
  }

  async toggleBlock(
    id: string,
    isActive: boolean,
  ): Promise<HomeBlockAdminItem> {
    const row = await this.blockRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Home block not found');
    row.isActive = isActive;
    const saved = await this.blockRepo.save(row);
    return this.toAdminItem(saved);
  }

  async deleteBlock(id: string): Promise<void> {
    const row = await this.blockRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Home block not found');
    if (row.type === 'system_rail') {
      throw new BadRequestException(
        'ریل‌های اصلی قابل حذف نیستند — غیرفعال کنید',
      );
    }
    await this.blockRepo.delete({ id });
  }

  /** Seed missing built-in rails (idempotent). Requires DB CHECK to allow system_rail. */
  private async ensureSystemRails(): Promise<void> {
    const existing = await this.blockRepo.find({
      where: { type: 'system_rail' },
    });
    const have = new Set(
      existing
        .map((row) => (row.config as SystemRailConfig).rail_id)
        .filter((id): id is NonNullable<typeof id> => Boolean(id)),
    );
    const missing = SYSTEM_RAIL_SEED.filter((seed) => !have.has(seed.rail_id));
    if (missing.length === 0) return;

    if (existing.length === 0) {
      await this.blockRepo
        .createQueryBuilder()
        .update(HomeBlock)
        .set({ sortOrder: () => '"sort_order" + 6' })
        .where('type <> :type', { type: 'system_rail' })
        .execute();
    }

    for (const seed of missing) {
      await this.blockRepo.save(
        this.blockRepo.create({
          id: seed.id,
          type: 'system_rail',
          title: SYSTEM_RAIL_LABELS[seed.rail_id],
          sortOrder: seed.sort_order,
          isActive: true,
          config: { rail_id: seed.rail_id },
        }),
      );
    }
  }

  private toAdminItem(row: HomeBlock): HomeBlockAdminItem {
    return {
      id: row.id,
      type: row.type,
      title: row.title,
      subtitle: row.subtitle,
      description: row.description,
      sort_order: row.sortOrder,
      is_active: row.isActive,
      config: row.config as Record<string, unknown>,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
