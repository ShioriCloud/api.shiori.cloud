import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import { BotFile, FilePack, FilePackItem, Anime, AnimeEpisode, AnimeSubtitle, AnimeSubtitlePack } from '../../entities';
import { isUuid } from '../../common/uuid.util';
import {
  AddFilePackItemDto,
  FilePickerRecentQueryDto,
  FilePickerSearchBodyDto,
  FilePickerSearchQueryDto,
  ListFilesStatsQueryDto,
  ListBotFilesQueryDto,
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

export type BotFileListItemRow = FileDownloadStatRow & {
  type: string | null;
  reference_count: number;
};

export type BotFileDetailRow = BotFileListItemRow & {
  message_id: string | null;
  file_id: string | null;
};

export type BotFileReferenceEpisode = {
  episode_id: string;
  episode_number: number | null;
  anime_id: string;
  anime_title: string;
  anime_slug: string | null;
};

export type BotFileReferenceSubtitle = {
  subtitle_id: string;
  episode_number: number;
  anime_id: string;
  anime_title: string;
  anime_slug: string | null;
};

export type BotFileReferenceSubtitlePack = {
  pack_id: string;
  title: string | null;
  anime_id: string;
  anime_title: string;
  anime_slug: string | null;
};

export type BotFileReferenceAnimeEpisodePack = {
  anime_id: string;
  anime_title: string;
  anime_slug: string | null;
  episode_pack_title: string | null;
};

export type BotFileReferenceFilePack = {
  pack_id: string;
  slug: string;
  title: string;
};

export type BotFileReferences = {
  episodes: BotFileReferenceEpisode[];
  subtitles: BotFileReferenceSubtitle[];
  subtitle_packs: BotFileReferenceSubtitlePack[];
  anime_episode_packs: BotFileReferenceAnimeEpisodePack[];
  file_packs: BotFileReferenceFilePack[];
  total: number;
};

const parseTelegramFileKeyFromLink = (link: string | null | undefined): string | null => {
  const raw = String(link ?? '').trim();
  if (!raw) return null;

  const fromUrl = raw.match(/[?&]start=get_([^&]+)/i)?.[1];
  if (fromUrl) {
    try {
      return decodeURIComponent(fromUrl).trim() || null;
    } catch {
      return fromUrl.trim() || null;
    }
  }

  const bare = raw.match(/^get_(.+)$/i)?.[1];
  if (!bare) return null;
  try {
    return decodeURIComponent(bare).trim() || null;
  } catch {
    return bare.trim() || null;
  }
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
    @InjectRepository(AnimeEpisode)
    private readonly episodeRepo: Repository<AnimeEpisode>,
    @InjectRepository(AnimeSubtitle)
    private readonly subtitleRepo: Repository<AnimeSubtitle>,
    @InjectRepository(AnimeSubtitlePack)
    private readonly subtitlePackRepo: Repository<AnimeSubtitlePack>,
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
  ) {}

  private assertFileKey(key: string): string {
    const clean = String(key ?? '').trim();
    if (!clean || clean.length > 128) {
      throw new BadRequestException('invalid file key');
    }
    return clean;
  }

  private fileLinkPattern(key: string): string {
    return `%get_${key.replace(/([%_\\])/g, '\\$1')}%`;
  }

  private mapFileListItem(file: BotFile, referenceCount = 0): BotFileListItemRow {
    return {
      ...this.mapFileStat(file),
      type: file.type,
      reference_count: referenceCount,
    };
  }

  private mapFileDetail(file: BotFile, referenceCount = 0): BotFileDetailRow {
    return {
      ...this.mapFileListItem(file, referenceCount),
      message_id: file.messageId,
      file_id: file.fileId,
    };
  }

  private applyStatusFilter(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
    query: { activeOnly?: boolean; status?: 'all' | 'active' | 'inactive' },
  ) {
    const status =
      query.status ??
      (query.activeOnly ? 'active' : 'all');

    if (status === 'active') {
      qb.andWhere('f.isActive = true');
    } else if (status === 'inactive') {
      qb.andWhere('f.isActive = false');
    }
  }

  private applyFileExtensionFilter(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
    fileExtension?: string,
  ) {
    const ext = String(fileExtension ?? '')
      .trim()
      .replace(/^\./, '')
      .toLowerCase();
    if (!ext) return;
    qb.andWhere('f.fileName ILIKE :fileExt', { fileExt: `%.${ext}` });
  }

  private applyOrphanOnlyFilter(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
  ) {
    qb.andWhere(`NOT EXISTS (
      SELECT 1 FROM episodes ep
      WHERE ep.download_link ILIKE '%' || 'get_' || f.key || '%'
    )`);
    qb.andWhere(`NOT EXISTS (
      SELECT 1 FROM subtitles sub
      WHERE sub.subtitle_link ILIKE '%' || 'get_' || f.key || '%'
    )`);
    qb.andWhere(`NOT EXISTS (
      SELECT 1 FROM subtitle_packs sp
      WHERE sp.subtitle_link ILIKE '%' || 'get_' || f.key || '%'
    )`);
    qb.andWhere(`NOT EXISTS (
      SELECT 1 FROM anime a
      WHERE a.episode_pack_link ILIKE '%' || 'get_' || f.key || '%'
    )`);
    qb.andWhere(`NOT EXISTS (
      SELECT 1 FROM file_pack_items fpi
      WHERE fpi.file_key = f.key
    )`);
  }

  private async countReferencesByKeysBatch(
    keys: string[],
  ): Promise<Map<string, number>> {
    const map = new Map<string, number>();
    keys.forEach((key) => map.set(key, 0));
    if (keys.length === 0) return map;

    const bump = (key: string | null | undefined) => {
      const clean = String(key ?? '').trim();
      if (!clean || !map.has(clean)) return;
      map.set(clean, (map.get(clean) ?? 0) + 1);
    };

    const patterns = keys.map((key) => this.fileLinkPattern(key));

    const [episodes, subtitles, subtitlePacks, animePacks, packItems] =
      await Promise.all([
        this.episodeRepo
          .createQueryBuilder('e')
          .select(['e.downloadLink'])
          .where('e.downloadLink ILIKE ANY(:patterns)', { patterns })
          .getMany(),
        this.subtitleRepo
          .createQueryBuilder('s')
          .select(['s.subtitleLink'])
          .where('s.subtitleLink ILIKE ANY(:patterns)', { patterns })
          .getMany(),
        this.subtitlePackRepo
          .createQueryBuilder('sp')
          .select(['sp.subtitleLink'])
          .where('sp.subtitleLink ILIKE ANY(:patterns)', { patterns })
          .getMany(),
        this.animeRepo
          .createQueryBuilder('a')
          .select(['a.episodePackLink'])
          .where('a.episodePackLink ILIKE ANY(:patterns)', { patterns })
          .getMany(),
        this.packItemsRepo.find({ where: { fileKey: In(keys) } }),
      ]);

    for (const row of episodes) bump(parseTelegramFileKeyFromLink(row.downloadLink));
    for (const row of subtitles) bump(parseTelegramFileKeyFromLink(row.subtitleLink));
    for (const row of subtitlePacks) {
      bump(parseTelegramFileKeyFromLink(row.subtitleLink));
    }
    for (const row of animePacks) {
      bump(parseTelegramFileKeyFromLink(row.episodePackLink));
    }
    for (const row of packItems) bump(row.fileKey);

    return map;
  }

  async listBotFiles(
    query: ListBotFilesQueryDto,
  ): Promise<{ items: BotFileListItemRow[]; total: number }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const qb = this.filesRepo.createQueryBuilder('f');
    this.applyStatusFilter(qb, query);
    this.applyFileExtensionFilter(qb, query.fileExtension);
    if (query.orphanOnly) this.applyOrphanOnlyFilter(qb);
    this.applyFileSearch(qb, query.search);

    const total = await qb.clone().getCount();
    const files = await qb
      .orderBy(this.sortColumn(query.sortBy), sortDir, 'NULLS LAST')
      .addOrderBy('f.key', 'ASC')
      .skip((page - 1) * limit)
      .take(limit)
      .getMany();

    const refCounts = await this.countReferencesByKeysBatch(files.map((f) => f.key));

    return {
      items: files.map((f) => this.mapFileListItem(f, refCounts.get(f.key) ?? 0)),
      total,
    };
  }

  async getBotFileByKey(key: string): Promise<BotFileDetailRow> {
    const fileKey = this.assertFileKey(key);
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    if (!file) throw new NotFoundException('file not found');

    const refCounts = await this.countReferencesByKeysBatch([fileKey]);
    return this.mapFileDetail(file, refCounts.get(fileKey) ?? 0);
  }

  async getFileReferences(key: string): Promise<BotFileReferences> {
    const fileKey = this.assertFileKey(key);
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    if (!file) throw new NotFoundException('file not found');

    const pattern = this.fileLinkPattern(fileKey);

    const [episodes, subtitles, subtitlePacks, animeEpisodePacks, filePacks] =
      await Promise.all([
        this.episodeRepo
          .createQueryBuilder('e')
          .innerJoinAndSelect('e.anime', 'a')
          .where('e.downloadLink ILIKE :pattern', { pattern })
          .orderBy('a.title', 'ASC')
          .addOrderBy('e.episodeNumber', 'ASC')
          .getMany(),
        this.subtitleRepo
          .createQueryBuilder('s')
          .innerJoinAndSelect('s.anime', 'a')
          .where('s.subtitleLink ILIKE :pattern', { pattern })
          .orderBy('a.title', 'ASC')
          .addOrderBy('s.episodeNumber', 'ASC')
          .getMany(),
        this.subtitlePackRepo
          .createQueryBuilder('sp')
          .innerJoinAndSelect('sp.anime', 'a')
          .where('sp.subtitleLink ILIKE :pattern', { pattern })
          .orderBy('a.title', 'ASC')
          .getMany(),
        this.animeRepo
          .createQueryBuilder('a')
          .where('a.episodePackLink ILIKE :pattern', { pattern })
          .orderBy('a.title', 'ASC')
          .getMany(),
        this.packItemsRepo
          .createQueryBuilder('i')
          .innerJoinAndSelect('i.pack', 'p')
          .where('i.fileKey = :fileKey', { fileKey })
          .orderBy('p.title', 'ASC')
          .getMany(),
      ]);

    const episodeRows = episodes
      .filter((row) => parseTelegramFileKeyFromLink(row.downloadLink) === fileKey)
      .map((row) => ({
        episode_id: row.id,
        episode_number: row.episodeNumber,
        anime_id: row.animeId,
        anime_title: row.anime?.title ?? '—',
        anime_slug: row.anime?.slug ?? null,
      }));

    const subtitleRows = subtitles
      .filter((row) => parseTelegramFileKeyFromLink(row.subtitleLink) === fileKey)
      .map((row) => ({
        subtitle_id: row.id,
        episode_number: row.episodeNumber,
        anime_id: row.animeId,
        anime_title: row.anime?.title ?? '—',
        anime_slug: row.anime?.slug ?? null,
      }));

    const subtitlePackRows = subtitlePacks
      .filter((row) => parseTelegramFileKeyFromLink(row.subtitleLink) === fileKey)
      .map((row) => ({
        pack_id: row.id,
        title: row.title,
        anime_id: row.animeId,
        anime_title: row.anime?.title ?? '—',
        anime_slug: row.anime?.slug ?? null,
      }));

    const animeEpisodePackRows = animeEpisodePacks
      .filter((row) => parseTelegramFileKeyFromLink(row.episodePackLink) === fileKey)
      .map((row) => ({
        anime_id: row.id,
        anime_title: row.title ?? '—',
        anime_slug: row.slug ?? null,
        episode_pack_title: row.episodePackTitle,
      }));

    const filePackRows = filePacks.map((row) => ({
      pack_id: row.packId,
      slug: row.pack?.slug ?? '',
      title: row.pack?.title ?? '—',
    }));

    const total =
      episodeRows.length +
      subtitleRows.length +
      subtitlePackRows.length +
      animeEpisodePackRows.length +
      filePackRows.length;

    return {
      episodes: episodeRows,
      subtitles: subtitleRows,
      subtitle_packs: subtitlePackRows,
      anime_episode_packs: animeEpisodePackRows,
      file_packs: filePackRows,
      total,
    };
  }

  async deactivateBotFile(key: string): Promise<BotFileDetailRow> {
    const fileKey = this.assertFileKey(key);
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    if (!file) throw new NotFoundException('file not found');

    file.isActive = false;
    file.lastAccessed = new Date();
    const saved = await this.filesRepo.save(file);

    const refCounts = await this.countReferencesByKeysBatch([fileKey]);
    return this.mapFileDetail(saved, refCounts.get(fileKey) ?? 0);
  }

  async reactivateBotFile(key: string): Promise<BotFileDetailRow> {
    const fileKey = this.assertFileKey(key);
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    if (!file) throw new NotFoundException('file not found');

    file.isActive = true;
    const saved = await this.filesRepo.save(file);

    const refCounts = await this.countReferencesByKeysBatch([fileKey]);
    return this.mapFileDetail(saved, refCounts.get(fileKey) ?? 0);
  }

  private assertPackId(packId: string): void {
    if (!isUuid(String(packId ?? '').trim())) {
      throw new BadRequestException('invalid pack id');
    }
  }

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

  /** Newest-first for picker lists (handles missing created_at on legacy/bot rows). */
  private applyPickerOrder(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
  ) {
    qb.orderBy('COALESCE(f.createdAt, f.lastAccessed)', 'DESC', 'NULLS LAST')
      .addOrderBy(
        "CASE WHEN f.key ~ '^[0-9]+$' THEN CAST(f.key AS BIGINT) END",
        'DESC',
        'NULLS LAST',
      )
      .addOrderBy('f.key', 'DESC');
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
      this.applyPickerOrder(qb);
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

    if (searchText) addRows(await fetchMatches(searchText, false));
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
      .take(limit);
    this.applyPickerOrder(qb);

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
      if (!isUuid(dto.id.trim())) {
        throw new BadRequestException('invalid pack id');
      }
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
    this.assertPackId(id);
    await this.packItemsRepo.delete({ packId: id });
    await this.packsRepo.delete({ id });
  }

  async listPackItems(packId: string): Promise<FilePackItemRow[]> {
    this.assertPackId(packId);
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
    this.assertPackId(packId);
    const pack = await this.packsRepo.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException('pack not found');

    await this.packItemsRepo.save({
      packId,
      fileKey: dto.file_key,
      sortOrder: dto.sort_order,
    });
  }

  async removePackItem(packId: string, fileKey: string): Promise<void> {
    this.assertPackId(packId);
    await this.packItemsRepo.delete({ packId, fileKey });
  }

  async updatePackItemSort(
    packId: string,
    fileKey: string,
    sortOrder: number,
  ): Promise<void> {
    this.assertPackId(packId);
    await this.packItemsRepo.update({ packId, fileKey }, { sortOrder });
  }

  async reorderPackItems(
    packId: string,
    dto: ReorderFilePackItemsDto,
  ): Promise<void> {
    this.assertPackId(packId);
    await Promise.all(
      dto.ordered_file_keys.map((fileKey, index) =>
        this.updatePackItemSort(packId, fileKey, index + 1),
      ),
    );
  }
}
