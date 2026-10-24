import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BootQuote } from '../../entities/boot-quote.entity';
import {
  CreateBootQuoteDto,
  ReorderBootQuotesDto,
  UpdateBootQuoteDto,
} from './boot-quotes-admin.dto';

export type BootQuoteAdminItem = {
  id: string;
  text: string;
  attribution: string;
  sort_order: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class BootQuotesAdminService {
  constructor(
    @InjectRepository(BootQuote)
    private readonly quoteRepo: Repository<BootQuote>,
  ) {}

  async listQuotes(): Promise<BootQuoteAdminItem[]> {
    const rows = await this.quoteRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.toAdminItem(row));
  }

  async getQuote(id: string): Promise<BootQuoteAdminItem> {
    const row = await this.quoteRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Boot quote not found');
    return this.toAdminItem(row);
  }

  async createQuote(body: CreateBootQuoteDto): Promise<BootQuoteAdminItem> {
    return this.quoteRepo.manager.transaction(async (manager) => {
      const maxSort = await manager
        .createQueryBuilder(BootQuote, 'q')
        .select('COALESCE(MAX(q.sortOrder), 0)', 'max')
        .getRawOne<{ max: string }>();

      const sortOrder = Number.parseInt(maxSort?.max ?? '0', 10) + 1;

      const row = manager.create(BootQuote, {
        text: body.text.trim(),
        attribution: body.attribution.trim(),
        imageUrl: null,
        isActive: body.is_active ?? true,
        sortOrder,
      });

      const saved = await manager.save(row);
      return this.toAdminItem(saved);
    });
  }

  async updateQuote(
    id: string,
    body: UpdateBootQuoteDto,
  ): Promise<BootQuoteAdminItem> {
    const row = await this.quoteRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Boot quote not found');

    if (body.text !== undefined) row.text = body.text.trim();
    if (body.attribution !== undefined)
      row.attribution = body.attribution.trim();
    if (body.is_active !== undefined) row.isActive = body.is_active;
    row.imageUrl = null;

    const saved = await this.quoteRepo.save(row);
    return this.toAdminItem(saved);
  }

  async reorderQuotes(
    body: ReorderBootQuotesDto,
  ): Promise<BootQuoteAdminItem[]> {
    const ids = body.ordered_ids;
    const rows = await this.quoteRepo.find();

    if (ids.length !== rows.length) {
      throw new BadRequestException('ordered_ids must include every quote');
    }

    if (new Set(ids).size !== ids.length) {
      throw new BadRequestException('ordered_ids must not contain duplicates');
    }

    const known = new Set(rows.map((r) => r.id));
    for (const id of ids) {
      if (!known.has(id)) {
        throw new BadRequestException(`Unknown quote id: ${id}`);
      }
    }

    const byId = new Map(rows.map((r) => [r.id, r]));
    for (let i = 0; i < ids.length; i++) {
      const row = byId.get(ids[i]!)!;
      row.sortOrder = i + 1;
    }

    await this.quoteRepo.save(rows);
    return this.listQuotes();
  }

  async toggleQuote(
    id: string,
    isActive: boolean,
  ): Promise<BootQuoteAdminItem> {
    const row = await this.quoteRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Boot quote not found');
    row.isActive = isActive;
    const saved = await this.quoteRepo.save(row);
    return this.toAdminItem(saved);
  }

  async deleteQuote(id: string): Promise<{ ok: true }> {
    const result = await this.quoteRepo.delete({ id });
    if (!result.affected) throw new NotFoundException('Boot quote not found');
    return { ok: true };
  }

  private toAdminItem(row: BootQuote): BootQuoteAdminItem {
    return {
      id: row.id,
      text: row.text,
      attribution: row.attribution,
      sort_order: row.sortOrder,
      is_active: row.isActive,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }
}
