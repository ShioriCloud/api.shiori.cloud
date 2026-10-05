import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Anime, BotSetting } from '../../entities';
import { fetchAnilistScoresByIds } from '../../common/anilist.client';
import { fetchMalScoreById, JikanClientError } from '../../common/jikan.client';
import { isAbortError } from '../../common/external-score.util';

export type ScoreSyncSource = 'mal' | 'anilist';

export type ScoreSyncLogLevel = 'info' | 'success' | 'warn' | 'error';

export type ScoreSyncLogEntry = {
  at: string;
  level: ScoreSyncLogLevel;
  anime_id?: string;
  title?: string;
  message: string;
};

export type ScoreSyncAttentionItem = {
  anime_id: string;
  title: string;
  reason: string;
};

export type ScoreSyncChangeItem = {
  anime_id: string;
  title: string;
  from: number | null;
  to: number;
};

export type ScoreSyncCounts = {
  updated: number;
  unchanged: number;
  no_score: number;
  errors: number;
};

export type ScoreSyncJobStatus =
  | 'running'
  | 'cancelling'
  | 'completed'
  | 'cancelled'
  | 'failed';

export type ScoreSyncFilters = {
  year: number | null;
  season: string | null;
};

export type ScoreSyncJobSnapshot = {
  id: string;
  source: ScoreSyncSource;
  status: ScoreSyncJobStatus;
  total: number;
  done: number;
  current_title: string | null;
  filters: ScoreSyncFilters;
  counts: ScoreSyncCounts;
  logs: ScoreSyncLogEntry[];
  attention: ScoreSyncAttentionItem[];
  top_changes: ScoreSyncChangeItem[];
  started_at: string;
  finished_at: string | null;
  error: string | null;
};

export type ScoreSyncLastRun = {
  source: ScoreSyncSource;
  finished_at: string;
  status: 'completed' | 'cancelled' | 'failed';
  total: number;
  done: number;
  filters?: ScoreSyncFilters;
  counts: ScoreSyncCounts;
  top_changes: ScoreSyncChangeItem[];
  attention: ScoreSyncAttentionItem[];
};

type AnimeScoreTarget = {
  id: string;
  title: string;
  titleRomaji: string | null;
  externalId: number;
  currentScore: string | null;
};

type MutableJob = ScoreSyncJobSnapshot & {
  cancelRequested: boolean;
};

const SETTING_KEYS: Record<ScoreSyncSource, string> = {
  mal: 'admin.score_sync.mal',
  anilist: 'admin.score_sync.anilist',
};

const MAX_LOGS = 250;
const MAX_ATTENTION = 40;
const MAX_TOP_CHANGES = 12;
const MAL_GAP_MS = 1100;
const ANILIST_BATCH = 50;
const ANILIST_GAP_MS = 400;

const KNOWN_SEASONS = new Set(['WINTER', 'SPRING', 'SUMMER', 'FALL']);

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

const interruptibleSleep = async (ms: number, shouldStop: () => boolean) => {
  const step = 100;
  let remaining = ms;
  while (remaining > 0) {
    if (shouldStop()) return;
    const chunk = Math.min(step, remaining);
    await sleep(chunk);
    remaining -= chunk;
  }
};

const displayTitle = (title: string, romaji: string | null) => {
  const t = title.trim();
  const r = (romaji ?? '').trim();
  if (t && r && t !== r) return `${t} (${r})`;
  return t || r || 'بدون عنوان';
};

const parseScore = (raw: string | null | undefined): number | null => {
  if (raw == null || raw === '') return null;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

const scoresEqual = (a: number | null, b: number | null): boolean => {
  if (a == null && b == null) return true;
  if (a == null || b == null) return false;
  return Math.abs(a - b) < 0.005;
};

const emptyCounts = (): ScoreSyncCounts => ({
  updated: 0,
  unchanged: 0,
  no_score: 0,
  errors: 0,
});

const emptyFilters = (): ScoreSyncFilters => ({ year: null, season: null });

const formatFilterLabel = (filters: ScoreSyncFilters): string => {
  const parts: string[] = [];
  if (filters.year != null) parts.push(String(filters.year));
  if (filters.season) parts.push(filters.season);
  return parts.length ? parts.join(' / ') : 'همه';
};

@Injectable()
export class ScoreSyncService {
  private currentJob: MutableJob | null = null;

  /** Aborts the in-flight Jikan/HTTP request when cancel is requested. */
  private jobHttpAbort: AbortController | null = null;

  constructor(
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(BotSetting)
    private readonly settingsRepo: Repository<BotSetting>,
  ) {}

  async getOverview(rawFilters?: { year?: unknown; season?: unknown }) {
    const filters = this.parseFilters(rawFilters ?? {});
    const [catalog, available, lastMal, lastAnilist] = await Promise.all([
      this.countCatalog(filters),
      this.loadAvailableFilters(),
      this.readLastRun('mal'),
      this.readLastRun('anilist'),
    ]);

    return {
      filters: {
        selected: filters,
        years: available.years,
        seasons: available.seasons,
      },
      catalog,
      last_runs: {
        mal: lastMal,
        anilist: lastAnilist,
      },
      job: this.snapshotJob(),
    };
  }

  getJob() {
    return { job: this.snapshotJob() };
  }

  async start(body: Record<string, unknown> = {}) {
    const source = this.parseSource(body.source ?? body.provider);
    const filters = this.parseFilters(body);
    if (this.currentJob && (this.currentJob.status === 'running' || this.currentJob.status === 'cancelling')) {
      throw new ConflictException('یک همگام‌سازی در حال اجراست');
    }

    const targets = await this.loadTargets(source, filters);
    const job: MutableJob = {
      id: `${source}-${Date.now()}`,
      source,
      status: 'running',
      total: targets.length,
      done: 0,
      current_title: null,
      filters,
      counts: emptyCounts(),
      logs: [],
      attention: [],
      top_changes: [],
      started_at: new Date().toISOString(),
      finished_at: null,
      error: null,
      cancelRequested: false,
    };

    this.pushLog(
      job,
      'info',
      `شروع همگام‌سازی ${source === 'mal' ? 'MyAnimeList' : 'AniList'} — فیلتر: ${formatFilterLabel(filters)} — ${targets.length} انیمه`,
    );

    this.currentJob = job;
    void this.runJob(job, targets);
    return this.snapshotJob();
  }

  cancel() {
    const job = this.currentJob;
    if (!job || (job.status !== 'running' && job.status !== 'cancelling')) {
      throw new BadRequestException('جاب در حال اجرایی برای توقف نیست');
    }
    job.cancelRequested = true;
    job.status = 'cancelling';
    this.jobHttpAbort?.abort();
    this.pushLog(job, 'warn', 'درخواست توقف ثبت شد — درخواست فعلی قطع می‌شود');
    return this.snapshotJob();
  }

  private isJobStopError(err: unknown): boolean {
    if (isAbortError(err)) return true;
    if (err instanceof JikanClientError && err.message === 'Request aborted') return true;
    const msg = err instanceof Error ? err.message : '';
    return msg === 'Request aborted';
  }

  private parseSource(value: unknown): ScoreSyncSource {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'mal' || raw === 'anilist') return raw;
    throw new BadRequestException('منبع نامعتبر است (mal | anilist)');
  }

  private parseFilters(raw: {
    year?: unknown;
    season?: unknown;
  }): ScoreSyncFilters {
    const yearRaw = raw.year;
    let year: number | null = null;
    if (yearRaw != null && String(yearRaw).trim() !== '' && String(yearRaw).trim() !== 'all') {
      const n = Number(yearRaw);
      if (!Number.isFinite(n) || n < 1900 || n > 2100) {
        throw new BadRequestException('سال نامعتبر است');
      }
      year = Math.trunc(n);
    }

    const seasonRaw = String(raw.season ?? '')
      .trim()
      .toUpperCase();
    let season: string | null = null;
    if (seasonRaw && seasonRaw !== 'ALL') {
      if (!KNOWN_SEASONS.has(seasonRaw)) {
        throw new BadRequestException('فصل نامعتبر است (WINTER|SPRING|SUMMER|FALL)');
      }
      season = seasonRaw;
    }

    return { year, season };
  }

  private snapshotJob(): ScoreSyncJobSnapshot | null {
    if (!this.currentJob) return null;
    const { cancelRequested: _, ...rest } = this.currentJob;
    return {
      ...rest,
      filters: { ...(rest.filters ?? emptyFilters()) },
      logs: [...rest.logs],
      attention: [...rest.attention],
      top_changes: [...rest.top_changes],
      counts: { ...rest.counts },
    };
  }

  private applyCatalogFilters(
    qb: ReturnType<Repository<Anime>['createQueryBuilder']>,
    filters: ScoreSyncFilters,
    alias = 'a',
  ) {
    if (filters.year != null) {
      qb.andWhere(`${alias}.year = :year`, { year: filters.year });
    }
    if (filters.season) {
      qb.andWhere(`UPPER(${alias}.season) = :season`, { season: filters.season });
    }
  }

  private async loadAvailableFilters(): Promise<{
    years: number[];
    seasons: string[];
  }> {
    const yearRows: Array<{ year: string | number | null }> = await this.animeRepo
      .createQueryBuilder('a')
      .select('DISTINCT a.year', 'year')
      .where('a.year IS NOT NULL')
      .orderBy('a.year', 'DESC')
      .getRawMany();

    const seasonRows: Array<{ season: string | null }> = await this.animeRepo
      .createQueryBuilder('a')
      .select('DISTINCT UPPER(a.season)', 'season')
      .where("a.season IS NOT NULL AND TRIM(a.season) <> ''")
      .getRawMany();

    const years = yearRows
      .map((row) => Number(row.year))
      .filter((n) => Number.isFinite(n))
      .sort((a, b) => b - a);

    const seasons = seasonRows
      .map((row) => String(row.season ?? '').trim().toUpperCase())
      .filter((s) => KNOWN_SEASONS.has(s));

    const orderedSeasons = ['WINTER', 'SPRING', 'SUMMER', 'FALL'].filter((s) =>
      seasons.includes(s),
    );

    return { years, seasons: orderedSeasons };
  }

  private async countCatalog(filters: ScoreSyncFilters) {
    const base = () => {
      const qb = this.animeRepo.createQueryBuilder('a');
      this.applyCatalogFilters(qb, filters);
      return qb;
    };

    const [total, withMal, withAnilist, withoutMal, withoutAnilist] =
      await Promise.all([
        base().getCount(),
        base().andWhere('a.malId IS NOT NULL').getCount(),
        base().andWhere('a.anilistId IS NOT NULL').getCount(),
        base().andWhere('a.malId IS NULL').getCount(),
        base().andWhere('a.anilistId IS NULL').getCount(),
      ]);

    return {
      total,
      with_mal_id: withMal,
      without_mal_id: withoutMal,
      with_anilist_id: withAnilist,
      without_anilist_id: withoutAnilist,
      mal_eta_seconds: withMal * Math.ceil(MAL_GAP_MS / 1000),
      anilist_eta_seconds:
        Math.ceil(withAnilist / ANILIST_BATCH) * Math.ceil(ANILIST_GAP_MS / 1000) +
        Math.ceil(withAnilist / ANILIST_BATCH) * 2,
    };
  }

  private async loadTargets(
    source: ScoreSyncSource,
    filters: ScoreSyncFilters,
  ): Promise<AnimeScoreTarget[]> {
    const qb = this.animeRepo
      .createQueryBuilder('a')
      .select([
        'a.id',
        'a.title',
        'a.titleRomaji',
        'a.malId',
        'a.anilistId',
        'a.malScore',
        'a.averageScore',
        'a.year',
        'a.season',
      ])
      .orderBy('a.title', 'ASC');

    if (source === 'mal') {
      qb.andWhere('a.malId IS NOT NULL');
    } else {
      qb.andWhere('a.anilistId IS NOT NULL');
    }
    this.applyCatalogFilters(qb, filters);

    const rows = await qb.getMany();
    return rows.map((row) => ({
      id: row.id,
      title: row.title,
      titleRomaji: row.titleRomaji,
      externalId: source === 'mal' ? Number(row.malId) : Number(row.anilistId),
      currentScore: source === 'mal' ? row.malScore : row.averageScore,
    }));
  }

  private async runJob(job: MutableJob, targets: AnimeScoreTarget[]) {
    this.jobHttpAbort = new AbortController();
    try {
      if (job.source === 'mal') {
        await this.runMal(job, targets);
      } else {
        await this.runAnilist(job, targets);
      }
      if (job.cancelRequested) {
        job.status = 'cancelled';
        this.pushLog(job, 'warn', `متوقف شد — ${job.done} از ${job.total}`);
      } else {
        job.status = 'completed';
        this.pushLog(
          job,
          'success',
          `تمام شد — به‌روز: ${job.counts.updated} · بدون تغییر: ${job.counts.unchanged} · بدون نمره: ${job.counts.no_score} · خطا: ${job.counts.errors}`,
        );
      }
    } catch (err) {
      job.status = 'failed';
      job.error = err instanceof Error ? err.message : 'خطای ناشناخته';
      this.pushLog(job, 'error', job.error);
    } finally {
      job.current_title = null;
      job.finished_at = new Date().toISOString();
      this.jobHttpAbort = null;
      await this.persistLastRun(job).catch(() => undefined);
    }
  }

  private malFetchSignal(): AbortSignal | undefined {
    return this.jobHttpAbort?.signal;
  }

  private async runMal(job: MutableJob, targets: AnimeScoreTarget[]) {
    for (let i = 0; i < targets.length; i += 1) {
      if (job.cancelRequested) break;
      const target = targets[i]!;
      const title = displayTitle(target.title, target.titleRomaji);
      job.current_title = title;

      try {
        const score = await fetchMalScoreById(target.externalId, {
          signal: this.malFetchSignal(),
        });
        if (job.cancelRequested) break;
        await this.applyScore(job, target, score, 'mal');
      } catch (err) {
        if (job.cancelRequested || this.isJobStopError(err)) break;
        job.counts.errors += 1;
        const message = err instanceof Error ? err.message : 'خطای Jikan';
        this.pushLog(job, 'error', `${title}: ${message}`, target.id, title);
        this.pushAttention(job, target.id, title, message);
      }

      job.done = i + 1;
      if (i < targets.length - 1 && !job.cancelRequested) {
        await interruptibleSleep(MAL_GAP_MS, () => job.cancelRequested);
      }
    }
  }

  private async runAnilist(job: MutableJob, targets: AnimeScoreTarget[]) {
    for (let offset = 0; offset < targets.length; offset += ANILIST_BATCH) {
      if (job.cancelRequested) break;
      const chunk = targets.slice(offset, offset + ANILIST_BATCH);
      job.current_title = displayTitle(chunk[0]!.title, chunk[0]!.titleRomaji);

      try {
        const rows = await fetchAnilistScoresByIds(chunk.map((t) => t.externalId));
        const found = new Map(rows.map((r) => [r.anilist_id, r]));

        for (const target of chunk) {
          if (job.cancelRequested) break;
          const title = displayTitle(target.title, target.titleRomaji);
          job.current_title = title;
          const remote = found.get(target.externalId);
          if (!remote) {
            job.counts.errors += 1;
            const reason = 'در پاسخ AniList نبود';
            this.pushLog(job, 'error', `${title}: ${reason}`, target.id, title);
            this.pushAttention(job, target.id, title, reason);
          } else {
            await this.applyScore(job, target, remote.average_score, 'anilist');
          }
          job.done += 1;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : 'خطای AniList';
        for (const target of chunk) {
          if (job.cancelRequested) break;
          const title = displayTitle(target.title, target.titleRomaji);
          job.counts.errors += 1;
          this.pushLog(job, 'error', `${title}: ${message}`, target.id, title);
          this.pushAttention(job, target.id, title, message);
          job.done += 1;
        }
      }

      if (offset + ANILIST_BATCH < targets.length && !job.cancelRequested) {
        await interruptibleSleep(ANILIST_GAP_MS, () => job.cancelRequested);
      }
    }
  }

  private async applyScore(
    job: MutableJob,
    target: AnimeScoreTarget,
    score: number | null,
    source: ScoreSyncSource,
  ) {
    const title = displayTitle(target.title, target.titleRomaji);
    const previous = parseScore(target.currentScore);

    if (score == null) {
      job.counts.no_score += 1;
      this.pushLog(job, 'warn', `${title}: نمره‌ای در منبع نبود`, target.id, title);
      this.pushAttention(job, target.id, title, 'نمره‌ای برنگشت');
      return;
    }

    if (scoresEqual(previous, score)) {
      job.counts.unchanged += 1;
      return;
    }

    const patch =
      source === 'mal'
        ? { malScore: String(score) }
        : { averageScore: String(score) };
    await this.animeRepo.update({ id: target.id }, patch);
    job.counts.updated += 1;
    this.pushLog(
      job,
      'success',
      `${title}: ${previous ?? '—'} → ${score}`,
      target.id,
      title,
    );
    this.pushChange(job, {
      anime_id: target.id,
      title,
      from: previous,
      to: score,
    });
  }

  private pushLog(
    job: MutableJob,
    level: ScoreSyncLogLevel,
    message: string,
    animeId?: string,
    title?: string,
  ) {
    job.logs.push({
      at: new Date().toISOString(),
      level,
      anime_id: animeId,
      title,
      message,
    });
    if (job.logs.length > MAX_LOGS) {
      job.logs.splice(0, job.logs.length - MAX_LOGS);
    }
  }

  private pushAttention(
    job: MutableJob,
    animeId: string,
    title: string,
    reason: string,
  ) {
    if (job.attention.length >= MAX_ATTENTION) return;
    if (job.attention.some((item) => item.anime_id === animeId && item.reason === reason)) {
      return;
    }
    job.attention.push({ anime_id: animeId, title, reason });
  }

  private pushChange(job: MutableJob, change: ScoreSyncChangeItem) {
    job.top_changes.push(change);
    job.top_changes.sort((a, b) => {
      const da = Math.abs((a.to ?? 0) - (a.from ?? a.to));
      const db = Math.abs((b.to ?? 0) - (b.from ?? b.to));
      return db - da;
    });
    if (job.top_changes.length > MAX_TOP_CHANGES) {
      job.top_changes.length = MAX_TOP_CHANGES;
    }
  }

  private async readLastRun(source: ScoreSyncSource): Promise<ScoreSyncLastRun | null> {
    const row = await this.settingsRepo.findOne({ where: { key: SETTING_KEYS[source] } });
    if (!row?.value) return null;
    try {
      const parsed = JSON.parse(row.value) as ScoreSyncLastRun;
      if (!parsed?.finished_at || parsed.source !== source) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async persistLastRun(job: MutableJob) {
    if (job.status === 'running' || job.status === 'cancelling') return;
    const payload: ScoreSyncLastRun = {
      source: job.source,
      finished_at: job.finished_at ?? new Date().toISOString(),
      status:
        job.status === 'completed'
          ? 'completed'
          : job.status === 'cancelled'
            ? 'cancelled'
            : 'failed',
      total: job.total,
      done: job.done,
      filters: { ...(job.filters ?? emptyFilters()) },
      counts: { ...job.counts },
      top_changes: [...job.top_changes],
      attention: [...job.attention].slice(0, 20),
    };
    await this.settingsRepo.save({
      key: SETTING_KEYS[job.source],
      value: JSON.stringify(payload),
      updatedAt: new Date(),
    });
  }
}
