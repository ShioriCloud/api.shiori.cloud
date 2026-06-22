import {
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BotFile, FilePack, FilePackItem } from '../../entities';
import {
  AddFilePackItemDto,
  FilePickerRecentQueryDto,
  FilePickerSearchBodyDto,
  FilePickerSearchQueryDto,
  ListFilesStatsQueryDto,
  ReorderFilePackItemsDto,
  UpsertFilePackDto,
} from './files-admin.dto';

export type FileDownloadStatRow = {
  key: string;
  file_name: string | null;
  caption: string | null;
  file_size: number | null;
  downloads: number;
  last_accessed: string | null;
  created_at: string | null;
  is_active: boolean;
};

export type FilePickerItemRow = {
  key: string;
  file_name: string | null;
  caption: string | null;
  is_active: boolean;
};

export type FilesDownloadOverview = {
  totalFiles: number;
  totalDownloads: number;
  activeFiles: number;
  inactiveFiles: number;
  topFiles: FileDownloadStatRow[];
};

export type FilePackRow = {
  id: string;
  slug: string;
  title: string;
  description: string | null;
  is_active: boolean;
  created_at: string | null;
  file_count: number;
};

export type FilePackItemRow = {
  pack_id: string;
  file_key: string;
  sort_order: number;
  created_at: string | null;
  file_name?: string | null;
};

const splitFileSearchTokens = (query?: string): string[] =>
  String(query ?? '')
    .trim()
    .split(/\s+/)
    .map((t) => t.replace(/,/g, ' ').trim())
    .filter((t) => t.length > 0);

@Injectable()
export class FilesAdminService {
  constructor(
    @InjectRepository(BotFile)
    private readonly filesRepo: Repository<BotFile>,
    @InjectRepository(FilePack)
    private readonly packsRepo: Repository<FilePack>,
    @InjectRepository(FilePackItem)
    private readonly packItemsRepo: Repository<FilePackItem>,
  ) {}

  private mapFileStat(file: BotFile): FileDownloadStatRow {
    return {
      key: file.key,
      file_name: file.fileName,
      caption: file.caption,
      file_size: file.fileSize != null ? Number(file.fileSize) : null,
      downloads: file.downloads ?? 0,
      last_accessed: file.lastAccessed?.toISOString?.() ?? null,
      created_at: file.createdAt?.toISOString?.() ?? null,
      is_active: file.isActive !== false,
    };
  }

  private mapPicker(file: BotFile): FilePickerItemRow {
    return {
      key: file.key,
      file_name: file.fileName,
      caption: file.caption,
      is_active: file.isActive !== false,
    };
  }

  private sortColumn(sortBy: ListFilesStatsQueryDto['sortBy']): string {
    switch (sortBy) {
      case 'created_at':
        return 'f.createdAt';
      case 'last_accessed':
        return 'f.lastAccessed';
      case 'file_name':
        return 'f.fileName';
      case 'key':
        return 'f.key';
      case 'downloads':
      default:
        return 'f.downloads';
    }
  }

  private applyFileSearch(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
    query?: string,
    fileNameOnly = false,
  ) {
    const tokens = splitFileSearchTokens(query);
    tokens.forEach((token, index) => {
      const likeKey = `fileLike${index}`;
      const like = `%${token.replace(/([%_\\])/g, '\\$1')}%`;
      if (fileNameOnly) {
        qb.andWhere(`f.fileName ILIKE :${likeKey}`, { [likeKey]: like });
      } else {
        qb.andWhere(
          `(f.key ILIKE :${likeKey} OR f.fileName ILIKE :${likeKey} OR f.caption ILIKE :${likeKey})`,
          { [likeKey]: like },
        );
      }
    });
  }

  async listDownloadStats(
    query: ListFilesStatsQueryDto,
  ): Promise<{ items: FileDownloadStatRow[]; total: number }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const qb = this.filesRepo.createQueryBuilder('f');
    if (query.activeOnly) {
      qb.andWhere('f.isActive = true');
    }
    this.applyFileSearch(qb, query.search);

    const total = await qb.clone().getCount();
    const files = await qb
      .orderBy(this.sortColumn(query.sortBy), sortDir, 'NULLS LAST')
      .addOrderBy('f.key', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    return {
      items: files.map((f) => this.mapFileStat(f)),
      total,
    };
  }

  async getDownloadOverview(): Promise<FilesDownloadOverview> {
    const totalFiles = await this.filesRepo.count();

    const agg = await this.filesRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.downloads), 0)', 'totalDownloads')
      .addSelect(
        'SUM(CASE WHEN f.isActive = true THEN 1 ELSE 0 END)',
        'activeFiles',
      )
      .getRawOne<{ totalDownloads: string; activeFiles: string }>();

    const totalDownloads = Number(agg?.totalDownloads) || 0;
    const activeFiles = Number(agg?.activeFiles) || 0;

    const topFiles = await this.filesRepo.find({
      order: { downloads: 'DESC' },
      take: 10,
    });

    return {
      totalFiles,
      totalDownloads,
      activeFiles,
      inactiveFiles: totalFiles - activeFiles,
      topFiles: topFiles.map((f) => this.mapFileStat(f)),
    };
  }

  async searchPicker(
    query: FilePickerSearchQueryDto | FilePickerSearchBodyDto,
  ): Promise<FilePickerItemRow[]> {
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const searchText = String(query.query ?? '').trim();
    const extraTerms = [
      ...new Set((query.matchAnyTerms ?? []).map((t) => String(t).trim()).filter(Boolean)),
    ];
    if (!searchText && extraTerms.length === 0) return [];

    const fileExtension = String(query.fileExtension ?? '')
      .trim()
      .replace(/^\./, '')
      .toLowerCase();

    const fetchMatches = async (term: string, fileNameOnly: boolean) => {
      const qb = this.filesRepo.createQueryBuilder('f').take(limit);
      if (query.activeOnly) qb.andWhere('f.isActive = true');
      if (fileExtension) {
        qb.andWhere('f.fileName ILIKE :ext', { ext: `%.${fileExtension}` });
      }
      this.applyFileSearch(qb, term, fileNameOnly);
      qb.orderBy('f.createdAt', 'DESC', 'NULLS LAST');
      const rows = await qb.getMany();
      return rows.map((f) => this.mapPicker(f));
    };

    const byKey = new Map<string, FilePickerItemRow>();
    const addRows = (rows: FilePickerItemRow[]) => {
      for (const row of rows) {
        if (!byKey.has(row.key)) byKey.set(row.key, row);
        if (byKey.size >= limit) break;
      }
    };

    if (searchText) addRows(await fetchMatches(searchText, true));
    for (const term of extraTerms) {
      if (byKey.size >= limit) break;
      addRows(await fetchMatches(term, true));
    }

    return [...byKey.values()].slice(0, limit);
  }

  async getPickerByKey(key: string): Promise<FilePickerItemRow | null> {
    const fileKey = String(key ?? '').trim();
    if (!fileKey) return null;
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    return file ? this.mapPicker(file) : null;
  }

  async getPickerByKeys(keysRaw: string): Promise<FilePickerItemRow[]> {
    const keys = [
      ...new Set(
        String(keysRaw ?? '')
          .split(',')
          .map((k) => k.trim())
          .filter(Boolean),
      ),
    ];
    if (keys.length === 0) return [];
    const files = await this.filesRepo.find({ where: { key: In(keys) } });
    return files.map((f) => this.mapPicker(f));
  }

  async getRecentPicker(query: FilePickerRecentQueryDto): Promise<FilePickerItemRow[]> {
    const limit = query.limit && query.limit > 0 ? query.limit : 30;
    const ext = String(query.fileExtension ?? '')
      .trim()
      .replace(/^\./, '')
      .toLowerCase();
    if (!ext) return [];

    const qb = this.filesRepo
      .createQueryBuilder('f')
      .where('f.fileName ILIKE :ext', { ext: `%.${ext}` })
      .orderBy('f.createdAt', 'DESC', 'NULLS LAST')
      .take(limit);

    if (query.activeOnly !== false) {
      qb.andWhere('f.isActive = true');
    }

    const files = await qb.getMany();
    return files.map((f) => this.mapPicker(f));
  }

  async listPacks(): Promise<FilePackRow[]> {
    const packs = await this.packsRepo.find({
      order: { createdAt: 'DESC' },
    });

    if (packs.length === 0) return [];

    const counts = await this.packItemsRepo
      .createQueryBuilder('i')
      .select('i.packId', 'pack_id')
      .addSelect('COUNT(*)', 'file_count')
      .where('i.packId IN (:...ids)', { ids: packs.map((p) => p.id) })
      .groupBy('i.packId')
      .getRawMany<{ pack_id: string; file_count: string }>();

    const countMap = new Map(
      counts.map((row) => [String(row.pack_id), Number(row.file_count) || 0]),
    );

    return packs.map((pack) => ({
      id: pack.id,
      slug: pack.slug,
      title: pack.title,
      description: pack.description,
      is_active: pack.isActive !== false,
      created_at: pack.createdAt?.toISOString?.() ?? null,
      file_count: countMap.get(pack.id) ?? 0,
    }));
  }

  async upsertPack(dto: UpsertFilePackDto): Promise<FilePackRow> {
    let pack: FilePack | null = null;

    if (dto.id) {
      pack = await this.packsRepo.findOne({ where: { id: dto.id } });
    }
    if (!pack) {
      pack = await this.packsRepo.findOne({ where: { slug: dto.slug } });
    }
    if (!pack) {
      pack = this.packsRepo.create();
    }

    pack.slug = dto.slug.trim();
    pack.title = dto.title.trim();
    pack.description =
      dto.description != null ? String(dto.description).trim() || null : null;
    pack.isActive = Boolean(dto.is_active);

    const saved = await this.packsRepo.save(pack);
    const fileCount = await this.packItemsRepo.count({
      where: { packId: saved.id },
    });

    return {
      id: saved.id,
      slug: saved.slug,
      title: saved.title,
      description: saved.description,
      is_active: saved.isActive !== false,
      created_at: saved.createdAt?.toISOString?.() ?? null,
      file_count: fileCount,
    };
  }

  async deletePack(id: string): Promise<void> {
    await this.packItemsRepo.delete({ packId: id });
    await this.packsRepo.delete({ id });
  }

  async listPackItems(packId: string): Promise<FilePackItemRow[]> {
    const items = await this.packItemsRepo.find({
      where: { packId },
      relations: { file: true },
      order: { sortOrder: 'ASC' },
    });

    return items.map((item) => ({
      pack_id: item.packId,
      file_key: item.fileKey,
      sort_order: item.sortOrder ?? 0,
      created_at: item.createdAt?.toISOString?.() ?? null,
      file_name: item.file?.fileName ?? null,
    }));
  }

  async addPackItem(packId: string, dto: AddFilePackItemDto): Promise<void> {
    const pack = await this.packsRepo.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException('pack not found');

    await this.packItemsRepo.save({
      packId,
      fileKey: dto.file_key,
      sortOrder: dto.sort_order,
    });
  }

  async removePackItem(packId: string, fileKey: string): Promise<void> {
    await this.packItemsRepo.delete({ packId, fileKey });
  }

  async updatePackItemSort(
    packId: string,
    fileKey: string,
    sortOrder: number,
  ): Promise<void> {
    await this.packItemsRepo.update({ packId, fileKey }, { sortOrder });
  }

  async reorderPackItems(
    packId: string,
    dto: ReorderFilePackItemsDto,
  ): Promise<void> {
    await Promise.all(
      dto.ordered_file_keys.map((fileKey, index) =>
        this.updatePackItemSort(packId, fileKey, index + 1),
      ),
    );
  }
}
