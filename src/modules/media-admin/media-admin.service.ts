import { randomUUID } from 'crypto';
import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { MediaAsset } from '../../entities';
import { ListMediaQueryDto, UpdateMediaDto } from './media-admin.dto';
import { MediaStorageService } from './media-storage.service';

export type MediaAssetRow = {
  id: string;
  file_name: string;
  original_name: string | null;
  mimetype: string;
  url: string;
  alt_text: string | null;
  caption: string | null;
  size: number;
  uploaded_by: string | null;
  created_at: string;
  updated_at: string;
};

@Injectable()
export class MediaAdminService {
  constructor(
    @InjectRepository(MediaAsset)
    private readonly mediaRepo: Repository<MediaAsset>,
    private readonly storage: MediaStorageService,
  ) {}

  private mapRow(asset: MediaAsset): MediaAssetRow {
    return {
      id: asset.id,
      file_name: asset.fileName,
      original_name: asset.originalName,
      mimetype: asset.mimetype,
      url: asset.url,
      alt_text: asset.altText,
      caption: asset.caption,
      size: asset.size != null ? Number(asset.size) : 0,
      uploaded_by: asset.uploadedBy,
      created_at: asset.createdAt?.toISOString?.() ?? new Date(0).toISOString(),
      updated_at: asset.updatedAt?.toISOString?.() ?? new Date(0).toISOString(),
    };
  }

  async list(query: ListMediaQueryDto): Promise<{
    items: MediaAssetRow[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }> {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const sortBy = query.sortBy ?? 'createdAt';
    const sortOrder = query.sortOrder ?? 'DESC';

    const sortColumnMap: Record<string, string> = {
      fileName: 'asset.fileName',
      mimetype: 'asset.mimetype',
      size: 'asset.size',
      createdAt: 'asset.createdAt',
      updatedAt: 'asset.updatedAt',
    };

    const qb = this.mediaRepo.createQueryBuilder('asset');

    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      qb.andWhere(
        '(asset.fileName ILIKE :term OR asset.originalName ILIKE :term OR asset.altText ILIKE :term OR asset.caption ILIKE :term)',
        { term },
      );
    }

    if (query.mimetype?.trim()) {
      qb.andWhere('asset.mimetype ILIKE :mimetype', {
        mimetype: query.mimetype.trim(),
      });
    } else {
      qb.andWhere('asset.mimetype ILIKE :imagePrefix', { imagePrefix: 'image/%' });
    }

    qb.orderBy(sortColumnMap[sortBy] ?? 'asset.createdAt', sortOrder);
    qb.skip((page - 1) * limit).take(limit);

    const [rows, total] = await qb.getManyAndCount();

    return {
      items: rows.map((row) => this.mapRow(row)),
      total,
      page,
      limit,
      totalPages: Math.max(1, Math.ceil(total / limit)),
    };
  }

  async getById(id: string): Promise<MediaAssetRow> {
    const asset = await this.mediaRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('media not found');
    return this.mapRow(asset);
  }

  async getEntityForServe(id: string): Promise<MediaAsset> {
    const asset = await this.mediaRepo.findOne({ where: { id } });
    if (!asset || !this.storage.fileExists(asset.storagePath)) {
      throw new NotFoundException('media not found');
    }
    return asset;
  }

  async upload(
    file: Express.Multer.File,
    uploadedBy: string,
  ): Promise<MediaAssetRow> {
    const saved = await this.storage.saveImage(file);
    const id = randomUUID();

    const asset = this.mediaRepo.create({
      id,
      fileName: saved.fileName,
      originalName: file.originalname?.trim() || null,
      mimetype: file.mimetype,
      url: this.storage.getPublicUrl(id),
      storagePath: saved.storagePath,
      size: String(file.size),
      uploadedBy,
      altText: null,
      caption: null,
    });

    const created = await this.mediaRepo.save(asset);
    return this.mapRow(created);
  }

  async update(id: string, body: UpdateMediaDto): Promise<MediaAssetRow> {
    const asset = await this.mediaRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('media not found');

    if (body.altText !== undefined) {
      asset.altText = body.altText.trim() || null;
    }
    if (body.caption !== undefined) {
      asset.caption = body.caption.trim() || null;
    }

    const saved = await this.mediaRepo.save(asset);
    return this.mapRow(saved);
  }

  async delete(id: string): Promise<void> {
    const asset = await this.mediaRepo.findOne({ where: { id } });
    if (!asset) throw new NotFoundException('media not found');

    await this.storage.deleteFile(asset.storagePath);
    await this.mediaRepo.delete({ id });
  }
}
