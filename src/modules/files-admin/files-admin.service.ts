import {
  Injectable,
  BadRequestException,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import { BotFile, BotFileDownloadEvent, FilePack, FilePackItem, Anime, AnimeEpisode, AnimeSubtitle, AnimeSubtitlePack } from '../../entities';
import { isUuid } from '../../common/uuid.util';
import {
  AddFilePackItemDto,
  FilePickerRecentQueryDto,
  FilePickerSearchBodyDto,
  FilePickerSearchQueryDto,
  ListAnimeDownloadStatsQueryDto,
  ListFilesStatsQueryDto,
  ListBotFilesQueryDto,
  PatchBotFileMetadataDto,
  ReorderFilePackItemsDto,
  UpsertFilePackDto,
} from './files-admin.dto';

export type AnimeEpisodeDownloadStatRow = {
  episode_id: string;
  episode_number: number | null;
  file_key: string | null;
  file_name: string | null;
  downloads: number;
  last_accessed: string | null;
};

export type AnimeDownloadStatRow = {
  anime_id: string;
  anime_title: string;
  anime_slug: string | null;
  total_downloads: number;
  episodes_with_file: number;
  episodes_total: number;
  last_accessed: string | null;
};

export type AnimeDownloadStatDetail = AnimeDownloadStatRow & {
  episodes: AnimeEpisodeDownloadStatRow[];
};

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

export type DownloadDailyTrendPoint = {
  date: string;
  count: number;
};

export type FilesDownloadOverview = {
  totalFiles: number;
  totalDownloads: number;
  activeFiles: number;
  inactiveFiles: number;
  downloadsLast24h: number;
  downloadsLast7d: number;
  downloadsLast30d: number;
  downloadsThisWeek: number;
  downloadsPreviousWeek: number;
  weekOverWeekChangePercent: number | null;
  dailyTrend: DownloadDailyTrendPoint[];
  eventTrackingSince: string | null;
  neverDownloaded: number;
  staleFiles: number;
  mkvFiles: number;
  zipFiles: number;
  mkvDownloads: number;
  zipDownloads: number;
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
    @InjectRepository(BotFileDownloadEvent)
    private readonly downloadEventsRepo: Repository<BotFileDownloadEvent>,
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

  private referencedFileKeysCache: { keys: Set<string>; expiresAt: number } | null = null;

  private async getReferencedFileKeysSet(): Promise<Set<string>> {
    const now = Date.now();
    if (this.referencedFileKeysCache && this.referencedFileKeysCache.expiresAt > now) {
      return this.referencedFileKeysCache.keys;
    }

    const keys = new Set<string>();
    const absorbLink = (link: string | null | undefined) => {
      const parsed = parseTelegramFileKeyFromLink(link);
      if (parsed) keys.add(parsed);
    };

    const [episodeRows, subtitleRows, subtitlePackRows, animeRows, packItemRows] =
      await Promise.all([
        this.episodeRepo
          .createQueryBuilder('e')
          .select('e.downloadLink', 'downloadLink')
          .where('e.downloadLink IS NOT NULL')
          .andWhere("e.downloadLink <> ''")
          .getRawMany<{ downloadLink: string }>(),
        this.subtitleRepo
          .createQueryBuilder('s')
          .select('s.subtitleLink', 'subtitleLink')
          .where('s.subtitleLink IS NOT NULL')
          .andWhere("s.subtitleLink <> ''")
          .getRawMany<{ subtitleLink: string }>(),
        this.subtitlePackRepo
          .createQueryBuilder('sp')
          .select('sp.subtitleLink', 'subtitleLink')
          .where('sp.subtitleLink IS NOT NULL')
          .andWhere("sp.subtitleLink <> ''")
          .getRawMany<{ subtitleLink: string }>(),
        this.animeRepo
          .createQueryBuilder('a')
          .select('a.episodePackLink', 'episodePackLink')
          .where('a.episodePackLink IS NOT NULL')
          .andWhere("a.episodePackLink <> ''")
          .getRawMany<{ episodePackLink: string }>(),
        this.packItemsRepo
          .createQueryBuilder('fpi')
          .select('fpi.fileKey', 'fileKey')
          .where('fpi.fileKey IS NOT NULL')
          .andWhere("fpi.fileKey <> ''")
          .getRawMany<{ fileKey: string }>(),
      ]);

    for (const row of episodeRows) absorbLink(row.downloadLink);
    for (const row of subtitleRows) absorbLink(row.subtitleLink);
    for (const row of subtitlePackRows) absorbLink(row.subtitleLink);
    for (const row of animeRows) absorbLink(row.episodePackLink);
    for (const row of packItemRows) {
      const key = String(row.fileKey ?? '').trim();
      if (key) keys.add(key);
    }

    this.referencedFileKeysCache = { keys, expiresAt: now + 60_000 };
    return keys;
  }

  private applyDownloadListFilters(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
    query: ListFilesStatsQueryDto,
  ) {
    if (query.activeOnly) {
      qb.andWhere('f.isActive = true');
    }
    if (query.zeroDownloads) {
      qb.andWhere('COALESCE(f.downloads, 0) = 0');
    }
    if (query.staleOnly) {
      this.applyStaleFileFilter(qb);
    }
    this.applyFileSearch(qb, query.search);
  }

  /** Active files with no recent download activity (30+ days). */
  private applyStaleFileFilter(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
  ) {
    qb.andWhere('f.isActive = true');
    qb.andWhere(`(
      (COALESCE(f.downloads, 0) = 0 AND COALESCE(f.createdAt, f.lastAccessed, NOW()) < NOW() - INTERVAL '30 days')
      OR
      (COALESCE(f.downloads, 0) > 0 AND (f.lastAccessed IS NULL OR f.lastAccessed < NOW() - INTERVAL '30 days'))
    )`);
  }

  private buildDailyTrend(
    rows: { day: string | Date; count: string | number }[],
    days = 30,
  ): DownloadDailyTrendPoint[] {
    const counts = new Map<string, number>();
    for (const row of rows) {
      const day =
        row.day instanceof Date
          ? row.day.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' })
          : String(row.day).slice(0, 10);
      counts.set(day, Number(row.count) || 0);
    }

    const result: DownloadDailyTrendPoint[] = [];

    for (let offset = days - 1; offset >= 0; offset--) {
      const anchor = new Date(Date.now() - offset * 86_400_000);
      const key = anchor.toLocaleDateString('en-CA', { timeZone: 'Asia/Tehran' });
      result.push({ date: key, count: counts.get(key) ?? 0 });
    }

    return result;
  }

  private async getEventOverviewStats(): Promise<{
    downloadsLast24h: number;
    downloadsLast7d: number;
    downloadsLast30d: number;
    downloadsThisWeek: number;
    downloadsPreviousWeek: number;
    eventTrackingSince: string | null;
    dailyTrend: DownloadDailyTrendPoint[];
  }> {
    const periodAgg = await this.downloadEventsRepo
      .createQueryBuilder('e')
      .select(
        `COUNT(*) FILTER (WHERE e.downloadedAt >= NOW() - INTERVAL '1 day')`,
        'downloadsLast24h',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.downloadedAt >= NOW() - INTERVAL '7 days')`,
        'downloadsLast7d',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.downloadedAt >= NOW() - INTERVAL '30 days')`,
        'downloadsLast30d',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.downloadedAt >= date_trunc('week', NOW()))`,
        'downloadsThisWeek',
      )
      .addSelect(
        `COUNT(*) FILTER (WHERE e.downloadedAt >= date_trunc('week', NOW()) - INTERVAL '7 days' AND e.downloadedAt < date_trunc('week', NOW()))`,
        'downloadsPreviousWeek',
      )
      .addSelect('MIN(e.downloadedAt)', 'eventTrackingSince')
      .getRawOne<{
        downloadsLast24h: string;
        downloadsLast7d: string;
        downloadsLast30d: string;
        downloadsThisWeek: string;
        downloadsPreviousWeek: string;
        eventTrackingSince: Date | string | null;
      }>();

    const trendRows = await this.downloadEventsRepo
      .createQueryBuilder('e')
      .select(`(e.downloadedAt AT TIME ZONE 'Asia/Tehran')::date`, 'day')
      .addSelect('COUNT(*)', 'count')
      .where(`e.downloadedAt >= NOW() - INTERVAL '29 days'`)
      .groupBy('day')
      .orderBy('day', 'ASC')
      .getRawMany<{ day: string; count: string }>();

    const since = periodAgg?.eventTrackingSince;
    return {
      downloadsLast24h: Number(periodAgg?.downloadsLast24h) || 0,
      downloadsLast7d: Number(periodAgg?.downloadsLast7d) || 0,
      downloadsLast30d: Number(periodAgg?.downloadsLast30d) || 0,
      downloadsThisWeek: Number(periodAgg?.downloadsThisWeek) || 0,
      downloadsPreviousWeek: Number(periodAgg?.downloadsPreviousWeek) || 0,
      eventTrackingSince:
        since instanceof Date
          ? since.toISOString()
          : since
            ? new Date(String(since)).toISOString()
            : null,
      dailyTrend: this.buildDailyTrend(trendRows, 30),
    };
  }

  private escapeCsvCell(
    value: string | number | boolean | null | undefined,
  ): string {
    const raw = value == null ? '' : String(value);
    if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
    return raw;
  }

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
    const exts = String(fileExtension ?? '')
      .split(',')
      .map((part) => part.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    if (exts.length === 0) return;
    if (exts.length === 1) {
      qb.andWhere('f.fileName ILIKE :fileExt', { fileExt: `%.${exts[0]}` });
      return;
    }
    qb.andWhere(
      new Brackets((sub) => {
        exts.forEach((ext, index) => {
          const key = `fileExt${index}`;
          if (index === 0) sub.where(`f.fileName ILIKE :${key}`, { [key]: `%.${ext}` });
          else sub.orWhere(`f.fileName ILIKE :${key}`, { [key]: `%.${ext}` });
        });
      }),
    );
  }

  private applyOrphanOnlyFilter(
    qb: ReturnType<Repository<BotFile>['createQueryBuilder']>,
    usedKeys: Set<string>,
  ) {
    if (usedKeys.size === 0) return;
    qb.andWhere('f.key NOT IN (:...orphanExcludeKeys)', {
      orphanExcludeKeys: [...usedKeys],
    });
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
    if (query.orphanOnly) {
      const usedKeys = await this.getReferencedFileKeysSet();
      this.applyOrphanOnlyFilter(qb, usedKeys);
    }
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

  async patchBotFileMetadata(
    key: string,
    dto: PatchBotFileMetadataDto,
  ): Promise<BotFileDetailRow> {
    const fileKey = this.assertFileKey(key);
    const file = await this.filesRepo.findOne({ where: { key: fileKey } });
    if (!file) throw new NotFoundException('file not found');

    if (dto.file_name !== undefined) {
      const name = String(dto.file_name ?? '').trim();
      file.fileName = name || null;
    }
    if (dto.caption !== undefined) {
      const caption = String(dto.caption ?? '').trim();
      file.caption = caption || null;
    }

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

  private async buildAnimeDownloadIndex(): Promise<{
    listRows: AnimeDownloadStatRow[];
    searchBlobByAnimeId: Map<string, string>;
  }> {
    const episodes = await this.episodeRepo
      .createQueryBuilder('e')
      .innerJoinAndSelect('e.anime', 'a')
      .getMany();

    const keys = new Set<string>();
    for (const ep of episodes) {
      const key = parseTelegramFileKeyFromLink(ep.downloadLink);
      if (key) keys.add(key);
    }

    const files =
      keys.size > 0
        ? await this.filesRepo.find({ where: { key: In([...keys]) } })
        : [];
    const fileMap = new Map(files.map((f) => [f.key, f]));

    type Agg = {
      anime_id: string;
      anime_title: string;
      anime_slug: string | null;
      episodes_total: number;
      episodes_with_file: number;
      total_downloads: number;
      last_accessed: Date | null;
      countedKeys: Set<string>;
      searchBlob: string;
    };

    const byAnime = new Map<string, Agg>();

    for (const ep of episodes) {
      const anime = ep.anime;
      if (!anime) continue;

      let agg = byAnime.get(ep.animeId);
      if (!agg) {
        const searchBlob = [anime.title, anime.slug, anime.titleRomaji]
          .map((v) => String(v ?? '').trim().toLowerCase())
          .filter(Boolean)
          .join(' ');
        agg = {
          anime_id: ep.animeId,
          anime_title: anime.title,
          anime_slug: anime.slug,
          episodes_total: 0,
          episodes_with_file: 0,
          total_downloads: 0,
          last_accessed: null,
          countedKeys: new Set(),
          searchBlob,
        };
        byAnime.set(ep.animeId, agg);
      }

      agg.episodes_total += 1;
      const fileKey = parseTelegramFileKeyFromLink(ep.downloadLink);
      if (!fileKey) continue;

      agg.episodes_with_file += 1;
      const file = fileMap.get(fileKey);
      if (!file) continue;

      if (!agg.countedKeys.has(fileKey)) {
        agg.countedKeys.add(fileKey);
        agg.total_downloads += file.downloads ?? 0;
      }

      const accessed = file.lastAccessed;
      if (accessed && (!agg.last_accessed || accessed > agg.last_accessed)) {
        agg.last_accessed = accessed;
      }
    }

    const listRows: AnimeDownloadStatRow[] = [...byAnime.values()].map((agg) => ({
      anime_id: agg.anime_id,
      anime_title: agg.anime_title,
      anime_slug: agg.anime_slug,
      total_downloads: agg.total_downloads,
      episodes_with_file: agg.episodes_with_file,
      episodes_total: agg.episodes_total,
      last_accessed: agg.last_accessed?.toISOString?.() ?? null,
    }));

    const searchBlobByAnimeId = new Map(
      [...byAnime.values()].map((agg) => [agg.anime_id, agg.searchBlob]),
    );

    return { listRows, searchBlobByAnimeId };
  }

  async listAnimeDownloadStats(
    query: ListAnimeDownloadStatsQueryDto,
  ): Promise<{ items: AnimeDownloadStatRow[]; total: number }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const sortDir = query.sortDir === 'asc' ? 1 : -1;
    const sortBy = query.sortBy ?? 'downloads';
    const search = String(query.search ?? '').trim().toLowerCase();

    const { listRows, searchBlobByAnimeId } = await this.buildAnimeDownloadIndex();

    let filtered = listRows;
    if (search) {
      const tokens = splitFileSearchTokens(search);
      filtered = listRows.filter((row) => {
        const blob =
          searchBlobByAnimeId.get(row.anime_id) ??
          [row.anime_title, row.anime_slug]
            .map((v) => String(v ?? '').toLowerCase())
            .join(' ');
        return tokens.every((token) => blob.includes(token.toLowerCase()));
      });
    }

    filtered.sort((a, b) => {
      let cmp = 0;
      switch (sortBy) {
        case 'title':
          cmp = a.anime_title.localeCompare(b.anime_title, 'fa');
          break;
        case 'last_accessed': {
          const at = a.last_accessed ? Date.parse(a.last_accessed) : 0;
          const bt = b.last_accessed ? Date.parse(b.last_accessed) : 0;
          cmp = at - bt;
          break;
        }
        case 'episodes':
          cmp = a.episodes_with_file - b.episodes_with_file;
          break;
        case 'downloads':
        default:
          cmp = a.total_downloads - b.total_downloads;
          break;
      }
      return cmp * sortDir;
    });

    const total = filtered.length;
    const items = filtered.slice((page - 1) * limit, page * limit);
    return { items, total };
  }

  async getAnimeDownloadStatDetail(animeId: string): Promise<AnimeDownloadStatDetail> {
    const id = String(animeId ?? '').trim();
    if (!isUuid(id)) throw new BadRequestException('invalid anime id');

    const anime = await this.animeRepo.findOne({ where: { id } });
    if (!anime) throw new NotFoundException('anime not found');

    const episodes = await this.episodeRepo.find({
      where: { animeId: id },
      order: { episodeNumber: 'ASC' },
    });

    const keys = [
      ...new Set(
        episodes
          .map((ep) => parseTelegramFileKeyFromLink(ep.downloadLink))
          .filter((k): k is string => Boolean(k)),
      ),
    ];

    const files =
      keys.length > 0
        ? await this.filesRepo.find({ where: { key: In(keys) } })
        : [];
    const fileMap = new Map(files.map((f) => [f.key, f]));

    const countedKeys = new Set<string>();
    let totalDownloads = 0;
    let lastAccessed: Date | null = null;
    let episodesWithFile = 0;

    const episodeRows: AnimeEpisodeDownloadStatRow[] = [];
    for (const ep of episodes) {
      const fileKey = parseTelegramFileKeyFromLink(ep.downloadLink);
      const file = fileKey ? fileMap.get(fileKey) : undefined;
      if (fileKey && file) {
        episodesWithFile += 1;
        if (!countedKeys.has(fileKey)) {
          countedKeys.add(fileKey);
          totalDownloads += file.downloads ?? 0;
        }
        const accessed = file.lastAccessed;
        if (accessed && (!lastAccessed || accessed > lastAccessed)) {
          lastAccessed = accessed;
        }
      }

      episodeRows.push({
        episode_id: ep.id,
        episode_number: ep.episodeNumber,
        file_key: fileKey,
        file_name: file?.fileName ?? null,
        downloads: file?.downloads ?? 0,
        last_accessed: file?.lastAccessed?.toISOString?.() ?? null,
      });
    }

    const lastAccessedIso = lastAccessed ? lastAccessed.toISOString() : null;

    return {
      anime_id: anime.id,
      anime_title: anime.title,
      anime_slug: anime.slug,
      total_downloads: totalDownloads,
      episodes_with_file: episodesWithFile,
      episodes_total: episodes.length,
      last_accessed: lastAccessedIso,
      episodes: episodeRows,
    };
  }

  async listDownloadStats(
    query: ListFilesStatsQueryDto,
  ): Promise<{ items: FileDownloadStatRow[]; total: number }> {
    const page = query.page && query.page > 0 ? query.page : 1;
    const limit = query.limit && query.limit > 0 ? query.limit : 20;
    const sortDir = query.sortDir === 'asc' ? 'ASC' : 'DESC';

    const qb = this.filesRepo.createQueryBuilder('f');
    this.applyDownloadListFilters(qb, query);

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

  async exportDownloadStatsCsv(query: ListFilesStatsQueryDto): Promise<string> {
    const { items } = await this.listDownloadStats({
      ...query,
      page: 1,
      limit: 5000,
    });

    const header = [
      'key',
      'file_name',
      'caption',
      'file_size',
      'downloads',
      'is_active',
      'created_at',
      'last_accessed',
    ];

    const rows = items.map((row) =>
      [
        row.key,
        row.file_name,
        row.caption,
        row.file_size,
        row.downloads,
        row.is_active,
        row.created_at,
        row.last_accessed,
      ]
        .map((cell) => this.escapeCsvCell(cell))
        .join(','),
    );

    return `\uFEFF${header.join(',')}\n${rows.join('\n')}`;
  }

  async getDownloadOverview(): Promise<FilesDownloadOverview> {
    const totalFiles = await this.filesRepo.count();

    const staleQb = this.filesRepo.createQueryBuilder('f');
    this.applyStaleFileFilter(staleQb);
    const staleFiles = await staleQb.getCount();

    const agg = await this.filesRepo
      .createQueryBuilder('f')
      .select('COALESCE(SUM(f.downloads), 0)', 'totalDownloads')
      .addSelect(
        'SUM(CASE WHEN f.isActive = true THEN 1 ELSE 0 END)',
        'activeFiles',
      )
      .addSelect(
        `SUM(CASE WHEN COALESCE(f.downloads, 0) = 0 THEN 1 ELSE 0 END)`,
        'neverDownloaded',
      )
      .addSelect(
        `SUM(CASE WHEN LOWER(f.fileName) LIKE '%.mkv' THEN 1 ELSE 0 END)`,
        'mkvFiles',
      )
      .addSelect(
        `SUM(CASE WHEN LOWER(f.fileName) LIKE '%.zip' THEN 1 ELSE 0 END)`,
        'zipFiles',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(f.fileName) LIKE '%.mkv' THEN f.downloads ELSE 0 END), 0)`,
        'mkvDownloads',
      )
      .addSelect(
        `COALESCE(SUM(CASE WHEN LOWER(f.fileName) LIKE '%.zip' THEN f.downloads ELSE 0 END), 0)`,
        'zipDownloads',
      )
      .getRawOne<{
        totalDownloads: string;
        activeFiles: string;
        neverDownloaded: string;
        mkvFiles: string;
        zipFiles: string;
        mkvDownloads: string;
        zipDownloads: string;
      }>();

    const totalDownloads = Number(agg?.totalDownloads) || 0;
    const activeFiles = Number(agg?.activeFiles) || 0;

    const eventStats = await this.getEventOverviewStats();
    const prevWeek = eventStats.downloadsPreviousWeek;
    const thisWeek = eventStats.downloadsThisWeek;
    const weekOverWeekChangePercent =
      prevWeek > 0
        ? Math.round(((thisWeek - prevWeek) / prevWeek) * 100)
        : thisWeek > 0
          ? 100
          : null;

    const topFiles = await this.filesRepo.find({
      order: { downloads: 'DESC' },
      take: 10,
    });

    return {
      totalFiles,
      totalDownloads,
      activeFiles,
      inactiveFiles: totalFiles - activeFiles,
      downloadsLast24h: eventStats.downloadsLast24h,
      downloadsLast7d: eventStats.downloadsLast7d,
      downloadsLast30d: eventStats.downloadsLast30d,
      downloadsThisWeek: eventStats.downloadsThisWeek,
      downloadsPreviousWeek: eventStats.downloadsPreviousWeek,
      weekOverWeekChangePercent,
      dailyTrend: eventStats.dailyTrend,
      eventTrackingSince: eventStats.eventTrackingSince,
      neverDownloaded: Number(agg?.neverDownloaded) || 0,
      staleFiles,
      mkvFiles: Number(agg?.mkvFiles) || 0,
      zipFiles: Number(agg?.zipFiles) || 0,
      mkvDownloads: Number(agg?.mkvDownloads) || 0,
      zipDownloads: Number(agg?.zipDownloads) || 0,
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

    const fetchMatches = async (term: string, fileNameOnly: boolean) => {
      const qb = this.filesRepo.createQueryBuilder('f').take(limit);
      if (query.activeOnly) qb.andWhere('f.isActive = true');
      this.applyFileExtensionFilter(qb, query.fileExtension);
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
    const exts = String(query.fileExtension ?? '')
      .split(',')
      .map((part) => part.trim().replace(/^\./, '').toLowerCase())
      .filter(Boolean);
    if (exts.length === 0) return [];

    const qb = this.filesRepo.createQueryBuilder('f').take(limit);
    this.applyFileExtensionFilter(qb, query.fileExtension);
    if (query.activeOnly !== false) qb.andWhere('f.isActive = true');
    this.applyPickerOrder(qb);
    const rows = await qb.getMany();
    return rows.map((f) => this.mapPicker(f));
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

  async addPackItemsBulk(
    packId: string,
    fileKeys: string[],
  ): Promise<{ added: number; skipped: number }> {
    this.assertPackId(packId);
    const pack = await this.packsRepo.findOne({ where: { id: packId } });
    if (!pack) throw new NotFoundException('pack not found');

    const unique = [...new Set(fileKeys.map((k) => String(k ?? '').trim()).filter(Boolean))];
    if (unique.length === 0) return { added: 0, skipped: 0 };

    const existing = await this.packItemsRepo.find({
      where: { packId },
      select: { fileKey: true, sortOrder: true },
    });
    const existingKeys = new Set(existing.map((row) => row.fileKey));
    const toAdd = unique.filter((key) => !existingKeys.has(key));
    const skipped = unique.length - toAdd.length;
    if (toAdd.length === 0) return { added: 0, skipped };

    const maxOrder = existing.reduce((max, row) => Math.max(max, row.sortOrder ?? 0), 0);
    await this.packItemsRepo.save(
      toAdd.map((fileKey, index) => ({
        packId,
        fileKey,
        sortOrder: maxOrder + index + 1,
      })),
    );

    return { added: toAdd.length, skipped };
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
