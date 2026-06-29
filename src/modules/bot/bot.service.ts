import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { BotFile, BotSetting, FilePack, FilePackItem } from '../../entities';
import {
  BotArchiveLinkDto,
  BotFileDto,
  BotPackDto,
  BotPackItemDto,
  CreateBotFileDto,
  UpdateBotFileByMessageDto,
  UpsertBotFileDto,
} from './bot.dto';

@Injectable()
export class BotService {
  constructor(
    @InjectRepository(BotFile)
    private readonly filesRepo: Repository<BotFile>,
    @InjectRepository(FilePack)
    private readonly packsRepo: Repository<FilePack>,
    @InjectRepository(FilePackItem)
    private readonly packItemsRepo: Repository<FilePackItem>,
    @InjectRepository(BotSetting)
    private readonly settingsRepo: Repository<BotSetting>,
    private readonly dataSource: DataSource,
  ) {}

  health(): { ok: true } {
    return { ok: true };
  }

  async getArchiveLinkByCode(code: string): Promise<{ ok: true; data: BotArchiveLinkDto }> {
    const file = await this.findActiveFileByKey(code);
    return { ok: true, data: this.mapArchiveLink(file) };
  }

  async getFileByKey(key: string): Promise<{ ok: true; data: BotFileDto }> {
    const file = await this.findActiveFileByKey(key);
    return { ok: true, data: this.mapFile(file) };
  }

  async createFile(dto: CreateBotFileDto): Promise<{ ok: true; data: BotFileDto }> {
    const key = String(dto.key ?? '').trim();
    if (!key) {
      throw new NotFoundException();
    }

    const entity = this.filesRepo.create({
      key,
      messageId: dto.messageId != null ? String(dto.messageId) : null,
      type: dto.type ?? null,
      fileId: dto.fileId ?? null,
      fileName: dto.fileName ?? null,
      fileSize: dto.fileSize != null ? String(dto.fileSize) : null,
      caption: dto.caption ?? null,
      downloads: dto.downloads ?? 0,
      isActive: dto.isActive !== false,
      createdAt: new Date(),
    });

    const saved = await this.filesRepo.save(entity);
    return { ok: true, data: this.mapFile(saved) };
  }

  async upsertFile(
    key: string,
    dto: UpsertBotFileDto,
  ): Promise<{ ok: true; data: BotFileDto }> {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      throw new NotFoundException();
    }

    const { rows } = await this.dataSource.query(
      `INSERT INTO files (
        key, message_id, type, file_id, file_name, file_size, caption, is_active, created_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, true, NOW())
      ON CONFLICT (key) DO UPDATE SET
        message_id = EXCLUDED.message_id,
        type = EXCLUDED.type,
        file_id = EXCLUDED.file_id,
        file_name = EXCLUDED.file_name,
        file_size = EXCLUDED.file_size,
        caption = EXCLUDED.caption,
        is_active = true
      RETURNING *`,
      [
        cleanKey,
        dto.messageId ?? null,
        dto.type ?? null,
        dto.fileId ?? null,
        dto.fileName ?? null,
        dto.fileSize ?? null,
        dto.caption ?? null,
      ],
    );

    return { ok: true, data: this.mapFileRow(rows[0]) };
  }

  async incrementDownloads(key: string): Promise<{ ok: true; data: BotFileDto }> {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      throw new NotFoundException();
    }

    try {
      const { rows } = await this.dataSource.query(
        `SELECT * FROM increment_file_downloads($1)`,
        [cleanKey],
      );
      if (rows[0]) {
        return { ok: true, data: this.mapFileRow(rows[0]) };
      }
    } catch (err: unknown) {
      const code = (err as { code?: string })?.code;
      if (code !== '42883') {
        throw err;
      }
    }

    const file = await this.filesRepo.findOne({
      where: { key: cleanKey, isActive: true },
    });
    if (!file) {
      throw new NotFoundException();
    }

    file.downloads = (file.downloads ?? 0) + 1;
    file.lastAccessed = new Date();
    const saved = await this.filesRepo.save(file);
    return { ok: true, data: this.mapFile(saved) };
  }

  async updateByMessageId(
    messageId: string,
    dto: UpdateBotFileByMessageDto,
  ): Promise<{ ok: true; data: { nModified: number } }> {
    const mid = String(messageId ?? '').trim();
    if (!mid) {
      return { ok: true, data: { nModified: 0 } };
    }

    const updates: Partial<BotFile> = {};
    if (dto.fileId !== undefined) updates.fileId = dto.fileId;
    if (dto.fileName !== undefined) updates.fileName = dto.fileName;
    if (dto.fileSize !== undefined) updates.fileSize = String(dto.fileSize);
    if (dto.caption !== undefined) updates.caption = dto.caption;

    if (Object.keys(updates).length === 0) {
      return { ok: true, data: { nModified: 0 } };
    }

    const result = await this.filesRepo
      .createQueryBuilder()
      .update(BotFile)
      .set(updates)
      .where('message_id = :mid', { mid })
      .execute();

    return { ok: true, data: { nModified: result.affected ?? 0 } };
  }

  async deactivateByMessageId(
    messageId: string,
  ): Promise<{ ok: true; data: { count: number } }> {
    const mid = String(messageId ?? '').trim();
    if (!mid) {
      return { ok: true, data: { count: 0 } };
    }

    const result = await this.filesRepo
      .createQueryBuilder()
      .update(BotFile)
      .set({ isActive: false, lastAccessed: () => 'now()' })
      .where('message_id = :mid', { mid })
      .andWhere('is_active = true')
      .execute();

    return { ok: true, data: { count: result.affected ?? 0 } };
  }

  async getPackBySlug(slug: string): Promise<{ ok: true; data: BotPackDto }> {
    const cleanSlug = String(slug ?? '').trim().toLowerCase();
    if (!cleanSlug) {
      throw new NotFoundException();
    }

    const pack = await this.packsRepo.findOne({ where: { slug: cleanSlug } });
    if (!pack) {
      throw new NotFoundException();
    }

    return {
      ok: true,
      data: {
        id: pack.id,
        slug: pack.slug,
        title: pack.title,
        description: pack.description,
        isActive: pack.isActive,
        createdAt: pack.createdAt?.toISOString(),
      },
    };
  }

  async getPackItems(packId: string): Promise<{ ok: true; data: BotPackItemDto[] }> {
    const cleanId = String(packId ?? '').trim();
    if (!cleanId) {
      return { ok: true, data: [] };
    }

    const items = await this.packItemsRepo.find({
      where: { packId: cleanId },
      order: { sortOrder: 'ASC' },
    });

    return {
      ok: true,
      data: items.map((item) => ({
        packId: item.packId,
        fileKey: item.fileKey,
        sortOrder: item.sortOrder,
      })),
    };
  }

  async getSetting(key: string): Promise<{ ok: true; data: { value: string } }> {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      throw new NotFoundException();
    }

    const row = await this.settingsRepo.findOne({ where: { key: cleanKey } });
    if (!row) {
      throw new NotFoundException();
    }

    return { ok: true, data: { value: row.value } };
  }

  async setSetting(key: string, value: string): Promise<{ ok: true }> {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      throw new NotFoundException();
    }

    await this.settingsRepo.save({
      key: cleanKey,
      value: String(value),
      updatedAt: new Date(),
    });

    return { ok: true };
  }

  async deleteSetting(key: string): Promise<{ ok: true; data: { deleted: boolean } }> {
    const cleanKey = String(key ?? '').trim();
    if (!cleanKey) {
      return { ok: true, data: { deleted: false } };
    }

    const result = await this.settingsRepo.delete({ key: cleanKey });
    return { ok: true, data: { deleted: (result.affected ?? 0) > 0 } };
  }

  private async findActiveFileByKey(code: string): Promise<BotFile> {
    const key = String(code ?? '').trim();
    if (!key) {
      throw new NotFoundException();
    }

    const file = await this.filesRepo.findOne({ where: { key } });
    if (!file?.isActive) {
      throw new NotFoundException();
    }

    return file;
  }

  private mapArchiveLink(file: BotFile): BotArchiveLinkDto {
    const messageId =
      file.messageId != null && file.messageId !== ''
        ? Number(file.messageId)
        : undefined;

    const dto: BotArchiveLinkDto = {
      id: file.key,
      code: file.key,
    };

    if (file.fileName?.trim()) dto.title = file.fileName.trim();
    if (file.type?.trim()) dto.type = file.type.trim();
    if (file.fileId?.trim()) dto.telegramFileId = file.fileId.trim();
    if (messageId != null && !Number.isNaN(messageId)) {
      dto.archiveMessageId = messageId;
    }
    if (file.caption?.trim()) dto.caption = file.caption.trim();

    return dto;
  }

  private mapFile(file: BotFile): BotFileDto {
    return this.mapFileRow({
      key: file.key,
      message_id: file.messageId,
      type: file.type,
      file_id: file.fileId,
      file_name: file.fileName,
      file_size: file.fileSize,
      caption: file.caption,
      downloads: file.downloads,
      last_accessed: file.lastAccessed,
      created_at: file.createdAt,
      is_active: file.isActive,
    });
  }

  private mapFileRow(row: Record<string, unknown>): BotFileDto {
    const messageId =
      row.message_id != null && row.message_id !== ''
        ? Number(row.message_id)
        : undefined;

    const dto: BotFileDto = { key: String(row.key) };

    if (messageId != null && !Number.isNaN(messageId)) dto.messageId = messageId;
    if (row.type) dto.type = String(row.type);
    if (row.file_id) dto.fileId = String(row.file_id);
    if (row.file_name) dto.fileName = String(row.file_name);
    if (row.file_size != null) dto.fileSize = Number(row.file_size);
    if (row.caption) dto.caption = String(row.caption);
    if (row.downloads != null) dto.downloads = Number(row.downloads);
    if (row.last_accessed) dto.lastAccessed = new Date(String(row.last_accessed)).toISOString();
    if (row.created_at) dto.createdAt = new Date(String(row.created_at)).toISOString();
    if (row.is_active != null) dto.isActive = Boolean(row.is_active);

    return dto;
  }
}
