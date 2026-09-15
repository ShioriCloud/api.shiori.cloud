import {
  BadRequestException,
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Not, Repository } from 'typeorm';
import { Anime, BotSetting } from '../../entities';
import { fetchAnilistScoresByIds } from '../../common/anilist.client';
import { fetchMalScoreById } from '../../common/jikan.client';

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

export type ScoreSyncJobSnapshot = {
  id: string;
  source: ScoreSyncSource;
  status: ScoreSyncJobStatus;
  total: number;
  done: number;
  current_title: string | null;
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

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

@Injectable()
export class ScoreSyncService {
  private currentJob: MutableJob | null = null;

  constructor(
    @InjectRepository(Anime)
    private readonly animeRepo: Repository<Anime>,
    @InjectRepository(BotSetting)
    private readonly settingsRepo: Repository<BotSetting>,
  ) {}

  async getOverview() {
    const [total, withMal, withAnilist, withoutMal, withoutAnilist, lastMal, lastAnilist] =
      await Promise.all([
        this.animeRepo.count(),
        this.animeRepo.count({ where: { malId: Not(IsNull()) } }),
        this.animeRepo.count({ where: { anilistId: Not(IsNull()) } }),
        this.animeRepo.count({ where: { malId: IsNull() } }),
        this.animeRepo.count({ where: { anilistId: IsNull() } }),
        this.readLastRun('mal'),
        this.readLastRun('anilist'),
      ]);

    return {
      catalog: {
        total,
        with_mal_id: withMal,
        without_mal_id: withoutMal,
        with_anilist_id: withAnilist,
        without_anilist_id: withoutAnilist,
        mal_eta_seconds: withMal * Math.ceil(MAL_GAP_MS / 1000),
        anilist_eta_seconds: Math.ceil(withAnilist / ANILIST_BATCH) * Math.ceil(ANILIST_GAP_MS / 1000) +
          Math.ceil(withAnilist / ANILIST_BATCH) * 2,
      },
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

  async start(sourceRaw: unknown) {
    const source = this.parseSource(sourceRaw);
    if (this.currentJob && (this.currentJob.status === 'running' || this.currentJob.status === 'cancelling')) {
      throw new ConflictException('یک همگام‌سازی در حال اجراست');
    }

    const targets = await this.loadTargets(source);
    const job: MutableJob = {
      id: `${source}-${Date.now()}`,
      source,
      status: 'running',
      total: targets.length,
      done: 0,
      current_title: null,
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
      `شروع همگام‌سازی ${source === 'mal' ? 'MyAnimeList' : 'AniList'} — ${targets.length} انیمه`,
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
    this.pushLog(job, 'warn', 'درخواست توقف ثبت شد — بعد از آیتم فعلی قطع می‌شود');
    return this.snapshotJob();
  }

  private parseSource(value: unknown): ScoreSyncSource {
    const raw = String(value ?? '')
      .trim()
      .toLowerCase();
    if (raw === 'mal' || raw === 'anilist') return raw;
    throw new BadRequestException('منبع نامعتبر است (mal | anilist)');
  }

  private snapshotJob(): ScoreSyncJobSnapshot | null {
    if (!this.currentJob) return null;
    const { cancelRequested: _, ...rest } = this.currentJob;
    return {
      ...rest,
      logs: [...rest.logs],
      attention: [...rest.attention],
      top_changes: [...rest.top_changes],
      counts: { ...rest.counts },
    };
  }

  private async loadTargets(source: ScoreSyncSource): Promise<AnimeScoreTarget[]> {
    const qb = this.animeRepo
      .createQueryBuilder('a')
      .select(['a.id', 'a.title', 'a.titleRomaji', 'a.malId', 'a.anilistId', 'a.malScore', 'a.averageScore'])
      .orderBy('a.title', 'ASC');

    if (source === 'mal') {
      qb.andWhere('a.malId IS NOT NULL');
    } else {
      qb.andWhere('a.anilistId IS NOT NULL');
    }

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
      await this.persistLastRun(job).catch(() => undefined);
    }
  }

  private async runMal(job: MutableJob, targets: AnimeScoreTarget[]) {
    for (let i = 0; i < targets.length; i += 1) {
      if (job.cancelRequested) break;
      const target = targets[i]!;
      const title = displayTitle(target.title, target.titleRomaji);
      job.current_title = title;

      try {
        const score = await fetchMalScoreById(target.externalId);
        await this.applyScore(job, target, score, 'mal');
      } catch (err) {
        job.counts.errors += 1;
        const message = err instanceof Error ? err.message : 'خطای Jikan';
        this.pushLog(job, 'error', `${title}: ${message}`, target.id, title);
        this.pushAttention(job, target.id, title, message);
      }

      job.done = i + 1;
      if (i < targets.length - 1 && !job.cancelRequested) {
        await sleep(MAL_GAP_MS);
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
        await sleep(ANILIST_GAP_MS);
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
