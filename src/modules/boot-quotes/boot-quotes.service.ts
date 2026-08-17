import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { BootQuote } from '../../entities/boot-quote.entity';

export type BootQuotePublicItem = {
  text: string;
  attribution: string;
  image?: string;
};

@Injectable()
export class BootQuotesService {
  constructor(
    @InjectRepository(BootQuote)
    private readonly quoteRepo: Repository<BootQuote>,
  ) {}

  async listActive(): Promise<{ quotes: BootQuotePublicItem[] }> {
    const rows = await this.quoteRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
      select: { text: true, attribution: true, imageUrl: true },
    });

    return {
      quotes: rows.map((row) => ({
        text: row.text,
        attribution: row.attribution,
        ...(row.imageUrl ? { image: row.imageUrl } : {}),
      })),
    };
  }
}
