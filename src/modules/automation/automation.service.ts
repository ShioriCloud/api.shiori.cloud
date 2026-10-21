import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import {
  Anime,
  AnimeAutomationConfig,
  AnimeSourceProfile,
  AutomationJob,
  AutomationJobEvent,
  SubtitleSubmission,
} from '../../entities';
import type { AutomationJobState } from '../../entities/automation-job.entity';
import type { AutomationStatus } from '../../entities/anime-automation-config.entity';
import { ChannelDraftsService } from '../bot/channel-drafts.service';
import { canTransition, WORKER_CLAIMABLE_STATES } from './automation.states';

/** Persian-only labels for the live Telegram status card. */
const JOB_STATE_FA: Record<string, string> = {
  SUBTITLE_RECEIVED: 'ساب دریافت شد',
  MATCHED: 'مچ شد',
  ELIGIBLE: 'آماده اجرا',
  SEARCHING: 'جستجوی ریلیز',
  AWAITING_SELECTION: 'نیاز به انتخاب ریلیز',
  DOWNLOAD_QUEUED: 'صف دانلود',
  DOWNLOADING: 'در حال دانلود',
  DOWNLOADED: 'دانلود شد',
  WAITING_FOR_SUBTITLE: 'منتظر ساب',
  ENCODING: 'انکود',
  MUXING: 'مکس ساب',
  VALIDATING: 'اعتبارسنجی',
  READY_FOR_ARCHIVE: 'آماده آرشیو',
  AWAITING_MANUAL_ARCHIVE: 'نیاز به آرشیو دستی',
  ARCHIVING: 'آپلود آرشیو',
  LINKED: 'لینک شد',
  DRAFT_QUEUED: 'صف پیش‌نویس',
  AWAITING_APPROVAL: 'منتظر تأیید انتشار',
  PUBLISHED: 'منتشر شد',
  NEEDS_REVIEW: 'نیاز به بررسی',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
};

const STAGE_HINT_FA: Record<string, string> = {
  ELIGIBLE: 'به‌زودی جستجوی ریلیز شروع می‌شود',
  SEARCHING: 'در حال پیدا کردن فایل روی Nyaa…',
  AWAITING_SELECTION: 'ریلیز پیدا نشد یا مبهم است — از داشبورد انتخاب کن',
  DOWNLOAD_QUEUED: 'دانلود در صف qBittorrent',
  DOWNLOADING: 'در حال دانلود ویدئو…',
  DOWNLOADED: 'دانلود تمام شد',
  WAITING_FOR_SUBTITLE: 'ویدئو هست؛ منتظر فایل ساب',
  MUXING: 'در حال مکس ساب روی ویدئو…',
  READY_FOR_ARCHIVE: 'خروجی آماده است',
  AWAITING_MANUAL_ARCHIVE:
    'فایل آماده است ولی حجم بالاست — آپلود دستی به کانال آرشیو لازم است',
  ARCHIVING: 'در حال آپلود به آرشیو…',
  AWAITING_APPROVAL:
    'پیش‌نویس آماده است — با دکمهٔ زیر همین پیام تأیید/ارسال کن',
  PUBLISHED: 'انتشار انجام شد',
  NEEDS_REVIEW: 'کار متوقف شده — جزئیات را در داشبورد ببین',
  FAILED: 'خطا رخ داد — Retry یا جزئیات جاب',
};

const TRIGGER_FA: Record<string, string> = {
  subtitle: 'ساب مترجم',
  manual: 'دستی',
  new_episode: 'اپیزود جدید',
};

const STAGE_PCT: Record<string, number> = {
  ELIGIBLE: 8,
  SEARCHING: 15,
  AWAITING_SELECTION: 18,
  DOWNLOAD_QUEUED: 25,
  DOWNLOADING: 40,
  DOWNLOADED: 55,
  WAITING_FOR_SUBTITLE: 58,
  MUXING: 70,
  VALIDATING: 75,
  READY_FOR_ARCHIVE: 80,
  AWAITING_MANUAL_ARCHIVE: 82,
  ARCHIVING: 88,
  LINKED: 92,
  DRAFT_QUEUED: 95,
  AWAITING_APPROVAL: 97,
  PUBLISHED: 100,
  NEEDS_REVIEW: 0,
  FAILED: 0,
  CANCELLED: 0,
};

@Injectable()
export class AutomationService {
  private readonly logger = new Logger(AutomationService.name);

  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeAutomationConfig)
    private readonly configRepo: Repository<AnimeAutomationConfig>,
    @InjectRepository(AnimeSourceProfile)
    private readonly profileRepo: Repository<AnimeSourceProfile>,
    @InjectRepository(AutomationJob)
    private readonly jobRepo: Repository<AutomationJob>,
    @InjectRepository(AutomationJobEvent)
    private readonly eventRepo: Repository<AutomationJobEvent>,
    @InjectRepository(SubtitleSubmission)
    private readonly subRepo: Repository<SubtitleSubmission>,
    private readonly channelDrafts: ChannelDraftsService,
    private readonly config: ConfigService,
  ) {}

  // ── Overview / list ─────────────────────────────────────────────

  async overview() {
    const configs = await this.configRepo.find();
    const byStatus = (s: AutomationStatus) =>
      configs.filter((c) => c.status === s).length;

    const activeStates = WORKER_CLAIMABLE_STATES;
    const running = await this.jobRepo.count({
      where: { state: In(activeStates) },
    });
    const waitingSub = await this.jobRepo.count({
      where: { state: 'WAITING_FOR_SUBTITLE' },
    });
    const failed = await this.jobRepo.count({ where: { state: 'FAILED' } });
    const needsReview = await this.jobRepo.count({
      where: { state: 'NEEDS_REVIEW' },
    });
    const awaitingApproval = await this.jobRepo.count({
      where: { state: 'AWAITING_APPROVAL' },
    });
    const awaitingArchive = await this.jobRepo.count({
      where: { state: In(['READY_FOR_ARCHIVE', 'AWAITING_MANUAL_ARCHIVE']) },
    });
    const awaitingSelection = await this.jobRepo.count({
      where: { state: 'AWAITING_SELECTION' },
    });
    // SEARCHING with several Nyaa misses — treated as attention
    const searchingStuck = await this.jobRepo
      .createQueryBuilder('j')
      .where('j.state = :st', { st: 'SEARCHING' })
      .andWhere("COALESCE((j.progress->>'nyaa_misses')::int, 0) >= :n", {
        n: 3,
      })
      .getCount();

    const needsAttention =
      needsReview +
      awaitingArchive +
      awaitingSelection +
      waitingSub +
      failed +
      searchingStuck;

    return {
      total_configured: configs.length,
      active: byStatus('active'),
      paused: byStatus('paused'),
      manual: byStatus('manual'),
      disabled: byStatus('disabled'),
      running_jobs: running,
      waiting_for_subtitle: waitingSub,
      failed_jobs: failed,
      needs_review: needsReview,
      awaiting_approval: awaitingApproval,
      awaiting_archive: awaitingArchive,
      awaiting_selection: awaitingSelection,
      searching_stuck: searchingStuck,
      needs_attention: needsAttention,
    };
  }

  /**
   * Seed/update automation configs for titles on the Shiori weekly schedule
   * (same eligibility as catalog airing schedule: RELEASING / NOT_YET_RELEASED
   * with airing_weekday + weekly formats).
   * New/disabled → active; paused/manual left unchanged.
   */
  async syncFromWeeklySchedule() {
    // Keep in sync with anime-catalog SHIORI_WEEKLY_SCHEDULE_FORMATS
    const weeklyFormats = [
      'TV',
      'TV_SHORT',
      'ONA',
      'ONA (CHINESE)',
      'OVA',
      'SPECIAL',
    ];

    const rows = await this.animeRepo
      .createQueryBuilder('a')
      .where('a.airing_status IN (:...statuses)', {
        statuses: ['RELEASING', 'NOT_YET_RELEASED'],
      })
      .andWhere('a.airing_weekday IS NOT NULL')
      .andWhere("TRIM(a.airing_weekday) <> ''")
      .andWhere('UPPER(TRIM(a.format)) IN (:...weeklyFormats)', {
        weeklyFormats,
      })
      .orderBy('a.title', 'ASC')
      .getMany();

    let created = 0;
    let activated = 0;
    let skipped = 0;
    const items: Array<{
      anime_id: string;
      title: string;
      action: string;
      status: string;
    }> = [];

    for (const anime of rows) {
      let config = await this.configRepo.findOne({
        where: { animeId: anime.id },
      });
      const isNew = !config;
      if (!config) {
        config = this.configRepo.create({
          animeId: anime.id,
          status: 'active',
          triggerMode: 'subtitle',
        });
        created += 1;
      } else if (config.status === 'disabled') {
        config.status = 'active';
        activated += 1;
      } else {
        skipped += 1;
        items.push({
          anime_id: anime.id,
          title: anime.title,
          action: 'unchanged',
          status: config.status,
        });
        await this.ensureProfile(anime.id, anime);
        continue;
      }

      config.updatedAt = new Date();
      await this.configRepo.save(config);
      await this.ensureProfile(anime.id, anime);
      items.push({
        anime_id: anime.id,
        title: anime.title,
        action: isNew ? 'created_active' : 'activated',
        status: 'active',
      });
    }

    return {
      ok: true as const,
      schedule_count: rows.length,
      created,
      activated,
      skipped_preserved: skipped,
      items,
    };
  }

  async listConfigs(opts: {
    q?: string;
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 50));
    const offset = Math.max(0, opts.offset ?? 0);

    const qb = this.configRepo
      .createQueryBuilder('c')
      .innerJoinAndSelect('c.anime', 'a')
      .orderBy('c.updatedAt', 'DESC')
      .take(limit)
      .skip(offset);

    if (opts.status) {
      qb.andWhere('c.status = :status', { status: opts.status });
    }
    if (opts.q?.trim()) {
      const q = `%${opts.q.trim()}%`;
      qb.andWhere(
        '(a.title ILIKE :q OR a.title_romaji ILIKE :q OR a.slug ILIKE :q)',
        { q },
      );
    }

    const [rows, total] = await qb.getManyAndCount();
    return {
      total,
      items: rows.map((c) => this.toConfigDto(c, c.anime)),
    };
  }

  async getAnimeBundle(animeId: string) {
    const anime = await this.requireAnime(animeId);
    const config =
      (await this.configRepo.findOne({ where: { animeId } })) ??
      (await this.ensureConfig(animeId));
    const profile =
      (await this.profileRepo.findOne({ where: { animeId } })) ??
      (await this.ensureProfile(animeId, anime));
    return {
      anime: { id: anime.id, slug: anime.slug, title: anime.title },
      config: this.toConfigDto(config, anime),
      source_profile: this.toProfileDto(profile),
      hints: await this.buildAutomationHints(animeId),
    };
  }

  /**
   * Lightweight hints for the simplified anime settings UI:
   * last successful release → suggest encoder chain for next episodes.
   */
  private async buildAutomationHints(animeId: string) {
    const last = await this.jobRepo.findOne({
      where: {
        animeId,
        state: In([
          'PUBLISHED',
          'AWAITING_APPROVAL',
          'LINKED',
          'READY_FOR_ARCHIVE',
          'AWAITING_MANUAL_ARCHIVE',
          'DOWNLOADED',
          'MUXING',
          'DOWNLOADING',
        ]),
      },
      order: { updatedAt: 'DESC' },
    });

    const releaseName = String(last?.selectedReleaseName ?? '').trim() || null;
    const groupMatch = releaseName?.match(/^\[([^\]]+)\]/);
    const lastGroup = groupMatch?.[1]?.trim() || null;
    const suggested = lastGroup
      ? [...new Set([lastGroup, 'ASW', 'Judas'].filter(Boolean))]
      : ['ASW', 'Judas'];

    return {
      last_episode:
        last?.episodeNumber != null ? Number(last.episodeNumber) : null,
      last_release_group: lastGroup,
      last_release_name: releaseName,
      suggested_groups: suggested,
    };
  }

  async upsertConfig(
    animeId: string,
    body: Record<string, unknown>,
  ) {
    await this.requireAnime(animeId);
    const config = await this.ensureConfig(animeId);

    if (body.status != null) {
      const s = String(body.status);
      if (!['disabled', 'active', 'paused', 'manual'].includes(s)) {
        throw new BadRequestException('invalid status');
      }
      config.status = s as AutomationStatus;
    }
    if (body.trigger_mode != null || body.triggerMode != null) {
      config.triggerMode = String(
        body.trigger_mode ?? body.triggerMode,
      ) as AnimeAutomationConfig['triggerMode'];
    }
    if (
      body.new_episode_trigger_enabled != null ||
      body.newEpisodeTriggerEnabled != null
    ) {
      config.newEpisodeTriggerEnabled = Boolean(
        body.new_episode_trigger_enabled ?? body.newEpisodeTriggerEnabled,
      );
    }
    if (body.start_episode !== undefined || body.startEpisode !== undefined) {
      const v = body.start_episode ?? body.startEpisode;
      config.startEpisode = v == null || v === '' ? null : Number(v);
    }
    if (body.end_episode !== undefined || body.endEpisode !== undefined) {
      const v = body.end_episode ?? body.endEpisode;
      config.endEpisode = v == null || v === '' ? null : Number(v);
    }
    if (
      body.excluded_episodes !== undefined ||
      body.excludedEpisodes !== undefined
    ) {
      config.excludedEpisodes = this.asNumberArray(
        body.excluded_episodes ?? body.excludedEpisodes,
      );
    }
    if (
      body.enabled_seasons !== undefined ||
      body.enabledSeasons !== undefined
    ) {
      config.enabledSeasons = this.asNumberArray(
        body.enabled_seasons ?? body.enabledSeasons,
      );
    }
    if (
      body.processing_method != null ||
      body.processingMethod != null
    ) {
      config.processingMethod = String(
        body.processing_method ?? body.processingMethod,
      );
    }

    config.updatedAt = new Date();
    const saved = await this.configRepo.save(config);
    return this.toConfigDto(saved);
  }

  async upsertSourceProfile(animeId: string, body: Record<string, unknown>) {
    const anime = await this.requireAnime(animeId);
    const profile = await this.ensureProfile(animeId, anime);

    const str = (a: string, b: string) =>
      body[a] !== undefined ? body[a] : body[b];

    if (str('canonical_title', 'canonicalTitle') !== undefined) {
      profile.canonicalTitle =
        str('canonical_title', 'canonicalTitle') == null
          ? null
          : String(str('canonical_title', 'canonicalTitle'));
    }
    if (str('alt_titles', 'altTitles') !== undefined) {
      profile.altTitles = this.asStringArray(str('alt_titles', 'altTitles'));
    }
    if (str('streaming_platform', 'streamingPlatform') !== undefined) {
      const v = str('streaming_platform', 'streamingPlatform');
      profile.streamingPlatform = v == null ? null : String(v);
    }
    if (str('preferred_groups', 'preferredGroups') !== undefined) {
      profile.preferredGroups = this.asStringArray(
        str('preferred_groups', 'preferredGroups'),
      );
    }
    if (str('fallback_groups', 'fallbackGroups') !== undefined) {
      profile.fallbackGroups = this.asStringArray(
        str('fallback_groups', 'fallbackGroups'),
      );
    }
    if (str('preferred_resolution', 'preferredResolution') != null) {
      profile.preferredResolution = String(
        str('preferred_resolution', 'preferredResolution'),
      );
    }
    if (str('preferred_codec', 'preferredCodec') != null) {
      profile.preferredCodec = String(str('preferred_codec', 'preferredCodec'));
    }
    if (str('selection_mode', 'selectionMode') != null) {
      profile.selectionMode = String(str('selection_mode', 'selectionMode'));
    }
    if (
      str('custom_encoding_enabled', 'customEncodingEnabled') !== undefined
    ) {
      profile.customEncodingEnabled = Boolean(
        str('custom_encoding_enabled', 'customEncodingEnabled'),
      );
    }
    if (str('handbrake_preset', 'handbrakePreset') !== undefined) {
      const v = str('handbrake_preset', 'handbrakePreset');
      profile.handbrakePreset = v == null ? null : String(v);
    }
    if (str('subtitle_default', 'subtitleDefault') !== undefined) {
      profile.subtitleDefault = Boolean(
        str('subtitle_default', 'subtitleDefault'),
      );
    }
    if (str('subtitle_forced', 'subtitleForced') !== undefined) {
      profile.subtitleForced = Boolean(
        str('subtitle_forced', 'subtitleForced'),
      );
    }
    if (str('search_patterns', 'searchPatterns') !== undefined) {
      profile.searchPatterns = this.asStringArray(
        str('search_patterns', 'searchPatterns'),
      );
    }
    if (str('excluded_keywords', 'excludedKeywords') !== undefined) {
      profile.excludedKeywords = this.asStringArray(
        str('excluded_keywords', 'excludedKeywords'),
      );
    }
    if (str('allowed_providers', 'allowedProviders') !== undefined) {
      profile.allowedProviders = this.asStringArray(
        str('allowed_providers', 'allowedProviders'),
      );
    }

    // Nyaa numbering: subtitle-local ep + offset = torrent ep (Bleach P4 #9 → 49)
    const extra = {
      ...((profile.extra && typeof profile.extra === 'object'
        ? profile.extra
        : {}) as Record<string, unknown>),
    };
    if (
      str('episode_search_offset', 'episodeSearchOffset') !== undefined
    ) {
      const v = Number(str('episode_search_offset', 'episodeSearchOffset'));
      if (Number.isFinite(v) && v !== 0) extra.episode_search_offset = v;
      else delete extra.episode_search_offset;
    }
    if (str('search_season', 'searchSeason') !== undefined) {
      const v = Number(str('search_season', 'searchSeason'));
      if (Number.isFinite(v) && v > 0) extra.search_season = v;
      else delete extra.search_season;
    }
    // Translator-channel subtitle title (match incoming .ass / zip names)
    if (str('subtitle_title', 'subtitleTitle') !== undefined) {
      const raw = str('subtitle_title', 'subtitleTitle');
      const cleaned =
        raw == null ? '' : String(raw).trim().replace(/[\\/:*?"<>|]/g, '');
      if (cleaned) extra.subtitle_title = cleaned;
      else delete extra.subtitle_title;
    }
    // Archive/out filename title segment (not used for Nyaa search)
    if (str('output_title', 'outputTitle') !== undefined) {
      const raw = str('output_title', 'outputTitle');
      const cleaned =
        raw == null ? '' : String(raw).trim().replace(/[\\/:*?"<>|]/g, '');
      if (cleaned) extra.output_title = cleaned;
      else delete extra.output_title;
    }
    if (body.extra && typeof body.extra === 'object') {
      Object.assign(extra, body.extra as Record<string, unknown>);
    }
    profile.extra = extra;

    profile.updatedAt = new Date();
    return this.toProfileDto(await this.profileRepo.save(profile));
  }

  // ── Jobs ────────────────────────────────────────────────────────

  async listJobs(opts: {
    state?: string;
    animeId?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(100, Math.max(1, opts.limit ?? 40));
    const offset = Math.max(0, opts.offset ?? 0);
    const qb = this.jobRepo
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.anime', 'a')
      .orderBy('j.updatedAt', 'DESC')
      .take(limit)
      .skip(offset);
    if (opts.state) qb.andWhere('j.state = :state', { state: opts.state });
    if (opts.animeId)
      qb.andWhere('j.anime_id = :animeId', { animeId: opts.animeId });
    const [rows, total] = await qb.getManyAndCount();
    return { total, items: rows.map((j) => this.toJobDto(j, j.anime)) };
  }

  async getJob(id: string) {
    const job = await this.jobRepo.findOne({
      where: { id },
      relations: { anime: true },
    });
    if (!job) throw new NotFoundException('Job not found');
    const events = await this.eventRepo.find({
      where: { jobId: id },
      order: { createdAt: 'ASC' },
      take: 100,
    });
    const profile = await this.profileRepo.findOne({
      where: { animeId: job.animeId },
    });
    return {
      job: this.toJobDto(job, job.anime),
      events: events.map((e) => ({
        id: e.id,
        from_state: e.fromState,
        to_state: e.toState,
        message: e.message,
        meta: e.meta,
        created_at: e.createdAt?.toISOString?.() ?? null,
      })),
      source_profile: profile ? this.toProfileDto(profile) : null,
    };
  }

  async transitionJob(
    id: string,
    toState: AutomationJobState,
    opts: {
      message?: string;
      meta?: Record<string, unknown>;
      patch?: Partial<AutomationJob>;
      /** Skip admin Telegram notify (e.g. intake already messaged admins). */
      skipAdminNotify?: boolean;
    } = {},
  ) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (!canTransition(job.state, toState)) {
      throw new BadRequestException(
        `Invalid transition ${job.state} → ${toState}`,
      );
    }
    const from = job.state;
    job.state = toState;
    if (opts.patch) Object.assign(job, opts.patch);
    job.updatedAt = new Date();
    const saved = await this.jobRepo.save(job);
    await this.eventRepo.save(
      this.eventRepo.create({
        jobId: job.id,
        fromState: from,
        toState,
        message: opts.message ?? `state → ${toState}`,
        meta: opts.meta ?? {},
      }),
    );
    const skipLive =
      opts.skipAdminNotify ||
      from === toState ||
      (toState === 'CANCELLED' &&
        String(opts.message ?? '').includes('superseded'));

    let finalJob = saved;
    if (!skipLive) {
      try {
        finalJob = await this.queueLiveStatus(saved, {
          message: opts.message,
          fromState: from,
        });
      } catch (err) {
        this.logger.warn(
          `live status queue failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        );
      }
    }
    return this.toJobDto(finalJob);
  }

  async cancelJob(id: string) {
    return this.transitionJob(id, 'CANCELLED', { message: 'cancelled by admin' });
  }

  /** Hard-remove job (+ cascaded events) so it leaves the dash list. */
  async deleteJob(id: string) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    await this.jobRepo.remove(job);
    return { ok: true as const, id };
  }

  async retryJob(id: string) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (
      ![
        'FAILED',
        'NEEDS_REVIEW',
        'CANCELLED',
        'AWAITING_SELECTION',
        'AWAITING_MANUAL_ARCHIVE',
        'WAITING_FOR_SUBTITLE',
        'SEARCHING',
        'ELIGIBLE',
      ].includes(job.state)
    ) {
      throw new BadRequestException('Job is not retryable from current state');
    }
    job.attemptCount += 1;
    job.errorMessage = null;
    job.errorCode = null;
    job.claimedAt = null;
    job.claimedBy = null;

    const hadMagnet = Boolean(job.selectedMagnet?.trim());
    const forceResearch =
      job.state === 'AWAITING_SELECTION' ||
      job.state === 'SEARCHING' ||
      job.state === 'ELIGIBLE' ||
      !hadMagnet;

    // Re-search when stuck on Nyaa / selection, or never had a magnet.
    // Keep magnet after qB / mux failures so Retry skips flaky Nyaa.
    if (forceResearch) {
      job.releaseCandidates = [];
      job.selectedMagnet = null;
      job.selectedReleaseName = null;
      job.torrentHash = null;
      // Clear worker Nyaa cooldown so next claim searches immediately
      job.progress = {
        ...(job.progress ?? {}),
        nyaa_last_attempt_at: 0,
        nyaa_misses: 0,
      };
    } else {
      job.releaseCandidates = [];
    }

    await this.jobRepo.save(job);

    if (hadMagnet && !forceResearch) {
      return this.transitionJob(id, 'DOWNLOAD_QUEUED', {
        message: `retry #${job.attemptCount} — resume with existing magnet`,
      });
    }

    return this.transitionJob(id, 'ELIGIBLE', {
      message: `retry #${job.attemptCount}`,
    });
  }

  async selectRelease(
    id: string,
    body: { release_name?: string; magnet?: string; torrent_hash?: string },
  ) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    if (
      !['AWAITING_SELECTION', 'NEEDS_REVIEW', 'SEARCHING', 'ELIGIBLE'].includes(
        job.state,
      )
    ) {
      throw new BadRequestException('Job not awaiting release selection');
    }
    return this.transitionJob(id, 'DOWNLOAD_QUEUED', {
      message: 'release selected',
      patch: {
        selectedReleaseName: body.release_name ?? job.selectedReleaseName,
        selectedMagnet: body.magnet ?? job.selectedMagnet,
        torrentHash: body.torrent_hash ?? job.torrentHash,
      },
    });
  }

  async createManualJob(body: {
    anime_id?: string;
    animeId?: string;
    episode_number?: number;
    episodeNumber?: number;
  }) {
    const animeId = String(body.anime_id ?? body.animeId ?? '').trim();
    const episodeNumber = Number(body.episode_number ?? body.episodeNumber);
    if (!animeId) throw new BadRequestException('anime_id required');
    if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      throw new BadRequestException('episode_number required');
    }
    await this.requireAnime(animeId);
    await this.ensureConfig(animeId);
    await this.ensureProfile(animeId);

    const key = `manual:${animeId}:${episodeNumber}`;
    const existing = await this.jobRepo.findOne({
      where: { idempotencyKey: key },
    });
    if (existing && !['PUBLISHED', 'CANCELLED', 'FAILED'].includes(existing.state)) {
      return this.toJobDto(existing);
    }

    const job = await this.jobRepo.save(
      this.jobRepo.create({
        idempotencyKey: existing ? `${key}:${Date.now()}` : key,
        animeId,
        episodeNumber,
        state: 'ELIGIBLE',
        triggerSource: 'manual',
      }),
    );
    await this.eventRepo.save(
      this.eventRepo.create({
        jobId: job.id,
        fromState: null,
        toState: 'ELIGIBLE',
        message: 'manual job created',
        meta: {},
      }),
    );
    await this.touchConfigJob(animeId, episodeNumber);
    return this.toJobDto(job);
  }

  // ── Subtitle intake (bot) ───────────────────────────────────────

  async ingestSubtitleSubmission(body: {
    telegram_chat_id?: string;
    telegramChatId?: string;
    telegram_message_id?: string | number;
    telegramMessageId?: string | number;
    telegram_file_id?: string;
    telegramFileId?: string;
    original_file_name?: string;
    originalFileName?: string;
    filename_title?: string;
    filenameTitle?: string;
    episode_number?: number;
    episodeNumber?: number;
    content_hash?: string;
    contentHash?: string;
    stored_path?: string;
    storedPath?: string;
    extracted_meta?: Record<string, unknown>;
    extractedMeta?: Record<string, unknown>;
    anime_id?: string;
    animeId?: string;
  }) {
    const chatId = String(
      body.telegram_chat_id ?? body.telegramChatId ?? '',
    ).trim();
    const messageId = String(
      body.telegram_message_id ?? body.telegramMessageId ?? '',
    ).trim();
    const fileName = String(
      body.original_file_name ?? body.originalFileName ?? '',
    ).trim();
    if (!chatId || !messageId || !fileName) {
      throw new BadRequestException(
        'telegram_chat_id, telegram_message_id, original_file_name required',
      );
    }

    const existing = await this.subRepo.findOne({
      where: { telegramChatId: chatId, telegramMessageId: messageId },
    });
    if (existing) {
      // Same Telegram post again (forward/retry): restart pipeline + refresh live status card
      return this.retriggerExistingSubmission(existing);
    }

    let animeId =
      String(body.anime_id ?? body.animeId ?? '').trim() || null;
    const filenameTitle = String(
      body.filename_title ?? body.filenameTitle ?? '',
    ).trim();
    const episodeNumber = Number(body.episode_number ?? body.episodeNumber);
    let matchNote: string | null = null;

    if (!animeId && filenameTitle) {
      const resolved = await this.resolveAnimeByTitle(filenameTitle);
      if (resolved.anime) {
        animeId = resolved.anime.id;
        matchNote = resolved.note;
      } else {
        matchNote = resolved.note;
      }
    }

    const submission = await this.subRepo.save(
      this.subRepo.create({
        animeId,
        episodeNumber: Number.isFinite(episodeNumber) ? episodeNumber : null,
        filenameTitle: filenameTitle || null,
        originalFileName: fileName,
        telegramFileId: String(
          body.telegram_file_id ?? body.telegramFileId ?? '',
        ).trim() || null,
        telegramMessageId: messageId,
        telegramChatId: chatId,
        contentHash:
          String(body.content_hash ?? body.contentHash ?? '').trim() || null,
        storedPath:
          String(body.stored_path ?? body.storedPath ?? '').trim() || null,
        extractedMeta: (body.extracted_meta ??
          body.extractedMeta ??
          {}) as Record<string, unknown>,
        status: animeId && Number.isFinite(episodeNumber) ? 'matched' : 'ambiguous',
        matchNote,
        revision: 1,
      }),
    );

    if (!animeId || !Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      return {
        ok: true as const,
        duplicate: false as const,
        submission: this.toSubmissionDto(submission),
        job: null,
        needs_review: true as const,
        reason: 'anime_or_episode_unresolved',
      };
    }

    return this.processMatchedSubmission(submission);
  }

  /** List subtitle submissions for admin inbox (ambiguous / ineligible / …). */
  async listSubtitleSubmissions(opts: {
    status?: string;
    limit?: number;
    offset?: number;
  }) {
    const limit = Math.min(Math.max(opts.limit ?? 50, 1), 200);
    const offset = Math.max(opts.offset ?? 0, 0);
    const qb = this.subRepo
      .createQueryBuilder('s')
      .leftJoinAndSelect('s.anime', 'a')
      .orderBy('s.createdAt', 'DESC')
      .take(limit)
      .skip(offset);
    if (opts.status && opts.status !== 'all') {
      qb.andWhere('s.status = :st', { st: opts.status });
    }
    const [rows, total] = await qb.getManyAndCount();
    return {
      total,
      items: rows.map((s) => ({
        ...this.toSubmissionDto(s),
        anime_title: s.anime?.title ?? null,
        anime_slug: s.anime?.slug ?? null,
      })),
    };
  }

  async resolveSubtitleSubmission(
    id: string,
    body: { anime_id?: string; animeId?: string; episode_number?: number; episodeNumber?: number },
  ) {
    const submission = await this.subRepo.findOne({ where: { id } });
    if (!submission) throw new NotFoundException('Submission not found');

    const animeId = String(body.anime_id ?? body.animeId ?? '').trim();
    const episodeNumber = Number(body.episode_number ?? body.episodeNumber);
    if (!animeId) throw new BadRequestException('anime_id required');
    if (!Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      throw new BadRequestException('episode_number required');
    }
    await this.requireAnime(animeId);

    submission.animeId = animeId;
    submission.episodeNumber = episodeNumber;
    submission.status = 'matched';
    submission.matchNote = 'resolved_by_admin';
    submission.revision = (submission.revision ?? 1) + 1;
    await this.subRepo.save(submission);

    return this.processMatchedSubmission(submission);
  }

  async rejectSubtitleSubmission(id: string) {
    const submission = await this.subRepo.findOne({ where: { id } });
    if (!submission) throw new NotFoundException('Submission not found');
    submission.status = 'rejected';
    submission.matchNote = submission.matchNote
      ? `${submission.matchNote};rejected_by_admin`
      : 'rejected_by_admin';
    await this.subRepo.save(submission);
    return { ok: true as const, submission: this.toSubmissionDto(submission) };
  }

  /**
   * After anime+episode are known: eligibility check → create/reattach job.
   */
  private async processMatchedSubmission(submission: SubtitleSubmission) {
    const animeId = String(submission.animeId ?? '').trim();
    const episodeNumber = Number(submission.episodeNumber);
    if (!animeId || !Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      return {
        ok: true as const,
        duplicate: false as const,
        submission: this.toSubmissionDto(submission),
        job: null,
        needs_review: true as const,
        reason: 'anime_or_episode_unresolved',
      };
    }

    const eligibility = await this.checkEligibility(animeId, episodeNumber);
    if (!eligibility.ok) {
      submission.status = 'ineligible';
      submission.matchNote = eligibility.reason;
      await this.subRepo.save(submission);
      return {
        ok: true as const,
        duplicate: false as const,
        submission: this.toSubmissionDto(submission),
        job: null,
        ineligible: true as const,
        reason: eligibility.reason,
      };
    }

    const anime = await this.requireAnime(animeId);

    if (eligibility.mode === 'manual') {
      const created = await this.createJobFromSubtitle(
        animeId,
        episodeNumber,
        submission.id,
        'NEEDS_REVIEW',
        'manual_mode_awaits_admin',
      );
      const job = await this.queueLiveStatus(created.job, {
        message: 'حالت دستی — منتظر اقدام ادمین',
      });
      return {
        ok: true as const,
        duplicate: false as const,
        submission: this.toSubmissionDto(submission),
        job: this.toJobDto(job, anime),
        awaits_admin: true as const,
        reattached: created.reattached,
      };
    }

    const created = await this.createJobFromSubtitle(
      animeId,
      episodeNumber,
      submission.id,
      'ELIGIBLE',
      'subtitle triggered',
    );
    const job = await this.queueLiveStatus(created.job, {
      message: created.reattached
        ? 'ساب به جاب موجود وصل شد'
        : 'ساب دریافت شد — جاب شروع شد',
    });
    return {
      ok: true as const,
      duplicate: false as const,
      submission: this.toSubmissionDto(submission),
      job: this.toJobDto(job, anime),
      reattached: created.reattached,
    };
  }

  /** Dash: queue channel publish via tel-bot poller (API cannot reach Telegram). */
  async requestPublish(jobId: string) {
    const job = await this.jobRepo.findOne({ where: { id: jobId } });
    if (!job) throw new NotFoundException('Job not found');
    if (job.state !== 'AWAITING_APPROVAL') {
      throw new BadRequestException(
        `Job must be AWAITING_APPROVAL (got ${job.state})`,
      );
    }
    if (!job.draftId) {
      throw new BadRequestException('Job has no draft_id — cannot publish');
    }
    const progress = { ...(job.progress ?? {}) };
    delete progress.publish_claimed_at;
    progress.publish_requested_at = new Date().toISOString();
    job.progress = progress;
    job.updatedAt = new Date();
    await this.jobRepo.save(job);
    await this.eventRepo.save(
      this.eventRepo.create({
        jobId: job.id,
        fromState: job.state,
        toState: job.state,
        message: 'publish requested from dash — awaiting tel-bot',
        meta: { draft_id: job.draftId },
      }),
    );
    return this.toJobDto(job);
  }

  /** Tel-bot: claim jobs whose dash publish was requested. */
  async claimPendingPublish(limitRaw?: number) {
    const limit = Math.min(Math.max(Number(limitRaw) || 5, 1), 20);
    const rows = await this.jobRepo
      .createQueryBuilder('j')
      .leftJoinAndSelect('j.anime', 'a')
      .where('j.state = :st', { st: 'AWAITING_APPROVAL' })
      .andWhere("j.draft_id IS NOT NULL")
      .andWhere("NULLIF(j.progress->>'publish_requested_at', '') IS NOT NULL")
      .andWhere("NULLIF(j.progress->>'publish_claimed_at', '') IS NULL")
      .orderBy('j.updatedAt', 'ASC')
      .take(limit)
      .getMany();

    const items: Array<{
      job_id: string;
      draft_id: string;
      anime_title: string | null;
      episode_number: number;
    }> = [];

    for (const job of rows) {
      job.progress = {
        ...(job.progress ?? {}),
        publish_claimed_at: new Date().toISOString(),
      };
      await this.jobRepo.save(job);
      items.push({
        job_id: job.id,
        draft_id: String(job.draftId),
        anime_title: job.anime?.title ?? null,
        episode_number: Number(job.episodeNumber),
      });
    }
    return { items };
  }

  /** Called after channel draft mark-published — close automation job. */
  async markPublishedByDraftId(draftId: string) {
    const job = await this.jobRepo.findOne({
      where: { draftId, state: 'AWAITING_APPROVAL' as AutomationJobState },
    });
    if (!job) return null;
    return this.transitionJob(job.id, 'PUBLISHED', {
      message: 'published via channel draft',
      patch: {
        progress: {
          ...(job.progress ?? {}),
          publish_completed_at: new Date().toISOString(),
        },
      },
    });
  }

  async bulkRetryJobs(opts: {
    state?: string;
    error_code?: string;
    errorCode?: string;
    limit?: number;
  }) {
    const state = String(opts.state ?? 'NEEDS_REVIEW').trim();
    const errorCode = String(opts.error_code ?? opts.errorCode ?? '').trim();
    const limit = Math.min(Math.max(Number(opts.limit) || 20, 1), 50);
    const qb = this.jobRepo
      .createQueryBuilder('j')
      .where('j.state = :state', { state })
      .orderBy('j.updatedAt', 'ASC')
      .take(limit);
    if (errorCode) {
      qb.andWhere('j.error_code = :ec', { ec: errorCode });
    }
    const rows = await qb.getMany();
    const results: Array<{ id: string; ok: boolean; error?: string }> = [];
    for (const job of rows) {
      try {
        await this.retryJob(job.id);
        results.push({ id: job.id, ok: true });
      } catch (err) {
        results.push({
          id: job.id,
          ok: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    return {
      ok: true as const,
      attempted: results.length,
      succeeded: results.filter((r) => r.ok).length,
      results,
    };
  }

  /** Escalate jobs stuck mid-pipeline with no updates. */
  async escalateStaleJobs(opts?: { olderThanMinutes?: number; limit?: number }) {
    const minutes = Math.max(Number(opts?.olderThanMinutes) || 180, 30);
    const limit = Math.min(Math.max(Number(opts?.limit) || 40, 1), 100);
    const staleStates: AutomationJobState[] = [
      'DOWNLOADING',
      'MUXING',
      'ARCHIVING',
      'ENCODING',
      'VALIDATING',
      'SEARCHING',
    ];
    const rows = await this.jobRepo
      .createQueryBuilder('j')
      .where('j.state IN (:...states)', { states: staleStates })
      .andWhere(`j.updated_at < now() - make_interval(mins => :m)`, {
        m: minutes,
      })
      .orderBy('j.updatedAt', 'ASC')
      .take(limit)
      .getMany();

    let escalated = 0;
    for (const job of rows) {
      await this.transitionJob(job.id, 'NEEDS_REVIEW', {
        message: `pipeline stale — no update for ${minutes}+ minutes`,
        patch: {
          errorCode: 'pipeline_stale',
          errorMessage: `stale in ${job.state}`,
          claimedAt: null,
          claimedBy: null,
        },
      });
      escalated += 1;
    }
    return { ok: true as const, checked: rows.length, escalated, minutes };
  }

  /**
   * Re-processing the same channel post: restart (or resume) and bump live TG card.
   */
  private async retriggerExistingSubmission(submission: SubtitleSubmission) {
    const animeId = String(submission.animeId ?? '').trim();
    const episodeNumber = Number(submission.episodeNumber);
    if (!animeId || !Number.isFinite(episodeNumber) || episodeNumber <= 0) {
      return {
        ok: true as const,
        duplicate: true as const,
        submission: this.toSubmissionDto(submission),
        job: null,
        needs_review: true as const,
        reason: 'anime_or_episode_unresolved',
      };
    }

    const anime = await this.requireAnime(animeId);
    let job =
      (await this.jobRepo.findOne({
        where: { subtitleSubmissionId: submission.id },
        order: { createdAt: 'DESC' },
      })) ??
      (await this.jobRepo.findOne({
        where: {
          animeId,
          episodeNumber,
          state: In([
            'ELIGIBLE',
            'SEARCHING',
            'AWAITING_SELECTION',
            'DOWNLOAD_QUEUED',
            'DOWNLOADING',
            'DOWNLOADED',
            'WAITING_FOR_SUBTITLE',
            'MUXING',
            'READY_FOR_ARCHIVE',
            'AWAITING_MANUAL_ARCHIVE',
            'ARCHIVING',
            'LINKED',
            'DRAFT_QUEUED',
            'AWAITING_APPROVAL',
            'NEEDS_REVIEW',
            'FAILED',
          ]),
        },
        order: { updatedAt: 'DESC' },
      }));

    if (job) {
      // Includes PUBLISHED/CANCELLED — force a fresh ELIGIBLE run on the same row
      // (createJobFromSubtitle would no-op on the existing idempotency key).
      job = await this.resetJobToEligible(
        job,
        submission.id,
        'پست ساب دوباره ارسال شد',
      );
    } else {
      const created = await this.createJobFromSubtitle(
        animeId,
        episodeNumber,
        submission.id,
        'ELIGIBLE',
        'subtitle re-posted',
      );
      job = created.job;
      if (job.state !== 'ELIGIBLE') {
        job = await this.resetJobToEligible(
          job,
          submission.id,
          'پست ساب دوباره ارسال شد',
        );
      }
    }

    job = await this.queueLiveStatus(job, {
      message: 'پست ساب دوباره ارسال شد — اجرای مجدد از اول',
    });

    return {
      ok: true as const,
      duplicate: true as const,
      restarted: true as const,
      submission: this.toSubmissionDto(submission),
      job: this.toJobDto(job, anime),
    };
  }

  /** Clear download/mux fields and park job at ELIGIBLE for a fresh worker run. */
  private async resetJobToEligible(
    job: AutomationJob,
    submissionId: string,
    message: string,
  ) {
    const from = job.state;
    const prevLive = (job.progress?.tg_live ?? {}) as Record<string, unknown>;
    const keepMessages =
      prevLive.messages && typeof prevLive.messages === 'object'
        ? prevLive.messages
        : {};

    job.state = 'ELIGIBLE';
    job.subtitleSubmissionId = submissionId;
    job.selectedMagnet = null;
    job.selectedReleaseName = null;
    job.torrentHash = null;
    job.downloadPath = null;
    job.outputPath = null;
    job.outputFileName = null;
    job.archiveFileKey = null;
    job.downloadLink = null;
    job.draftId = null;
    job.releaseCandidates = [];
    job.errorMessage = null;
    job.errorCode = null;
    job.claimedAt = null;
    job.claimedBy = null;
    job.attemptCount = (job.attemptCount ?? 0) + 1;
    job.progress = {
      tg_live: {
        html: String(prevLive.html ?? ''),
        rev: Number(prevLive.rev) || 0,
        delivered_rev: Number(prevLive.delivered_rev) || 0,
        messages: keepMessages,
      },
    };
    job.updatedAt = new Date();
    const saved = await this.jobRepo.save(job);
    await this.eventRepo.save(
      this.eventRepo.create({
        jobId: saved.id,
        fromState: from,
        toState: 'ELIGIBLE',
        message,
        meta: { submission_id: submissionId, restarted: true },
      }),
    );
    await this.touchConfigJob(job.animeId, Number(job.episodeNumber));
    return saved;
  }

  private async createJobFromSubtitle(
    animeId: string,
    episodeNumber: number,
    submissionId: string,
    state: AutomationJobState,
    message: string,
  ): Promise<{ job: AutomationJob; reattached: boolean }> {
    const key = `sub:${animeId}:${episodeNumber}:${submissionId}`;
    let job = await this.jobRepo.findOne({ where: { idempotencyKey: key } });
    if (job) return { job, reattached: false };

    // Re-attach subtitle to a job already waiting mid-pipeline (don't spawn a twin)
    if (state === 'ELIGIBLE') {
      const attachable = await this.jobRepo.find({
        where: {
          animeId,
          episodeNumber,
          state: In(['WAITING_FOR_SUBTITLE', 'DOWNLOADED']),
        },
        order: { updatedAt: 'DESC' },
        take: 1,
      });
      if (attachable.length) {
        const target = attachable[0];
        const from = target.state;
        target.subtitleSubmissionId = submissionId;
        target.claimedAt = null;
        target.claimedBy = null;
        target.errorMessage = null;
        target.errorCode = null;
        // Keep WAITING_FOR_SUBTITLE so worker reclaims and retries mux with new file_id
        if (target.state === 'DOWNLOADED') {
          target.state = 'WAITING_FOR_SUBTITLE';
        }
        target.updatedAt = new Date();
        job = await this.jobRepo.save(target);
        await this.eventRepo.save(
          this.eventRepo.create({
            jobId: job.id,
            fromState: from,
            toState: job.state,
            message: 'subtitle reattached — resume mux',
            meta: { submission_id: submissionId },
          }),
        );
        await this.touchConfigJob(animeId, episodeNumber);
        return { job, reattached: true };
      }
    }

    // supersede older open jobs for same ep (full restart when new subtitle arrives)
    const open = await this.jobRepo.find({
      where: {
        animeId,
        episodeNumber,
        state: In([
          'ELIGIBLE',
          'SEARCHING',
          'AWAITING_SELECTION',
          'DOWNLOAD_QUEUED',
          'DOWNLOADING',
          'DOWNLOADED',
          'WAITING_FOR_SUBTITLE',
          'ENCODING',
          'MUXING',
          'VALIDATING',
          'READY_FOR_ARCHIVE',
          'AWAITING_MANUAL_ARCHIVE',
          'ARCHIVING',
          'LINKED',
          'DRAFT_QUEUED',
          'AWAITING_APPROVAL',
          'NEEDS_REVIEW',
          'FAILED',
        ]),
      },
    });
    const inheritedMessages: Record<string, number> = {};
    for (const j of open) {
      const live = (j.progress?.tg_live ?? {}) as Record<string, unknown>;
      const msgs = live.messages;
      if (msgs && typeof msgs === 'object') {
        for (const [chatId, msgId] of Object.entries(
          msgs as Record<string, number>,
        )) {
          const n = Number(msgId);
          if (chatId && Number.isFinite(n) && n > 0) inheritedMessages[chatId] = n;
        }
      }
      j.state = 'CANCELLED';
      j.errorMessage = 'superseded by newer subtitle submission';
      await this.jobRepo.save(j);
    }

    job = await this.jobRepo.save(
      this.jobRepo.create({
        idempotencyKey: key,
        animeId,
        episodeNumber,
        state,
        triggerSource: 'subtitle',
        subtitleSubmissionId: submissionId,
        progress:
          Object.keys(inheritedMessages).length > 0
            ? {
                tg_live: {
                  html: '',
                  rev: 0,
                  delivered_rev: 0,
                  messages: inheritedMessages,
                },
              }
            : {},
      }),
    );
    await this.eventRepo.save(
      this.eventRepo.create({
        jobId: job.id,
        fromState: null,
        toState: state,
        message,
        meta: { submission_id: submissionId },
      }),
    );
    await this.touchConfigJob(animeId, episodeNumber);
    return { job, reattached: false };
  }

  async checkEligibility(animeId: string, episodeNumber: number) {
    const config = await this.ensureConfig(animeId);
    if (config.status === 'disabled') {
      return { ok: false as const, reason: 'automation_disabled' };
    }
    if (config.status === 'paused') {
      return { ok: false as const, reason: 'automation_paused' };
    }
    if (
      config.startEpisode != null &&
      episodeNumber < Number(config.startEpisode)
    ) {
      return { ok: false as const, reason: 'before_start_episode' };
    }
    if (
      config.endEpisode != null &&
      episodeNumber > Number(config.endEpisode)
    ) {
      return { ok: false as const, reason: 'after_end_episode' };
    }
    const excluded = (config.excludedEpisodes ?? []).map(Number);
    if (excluded.includes(Number(episodeNumber))) {
      return { ok: false as const, reason: 'episode_excluded' };
    }
    return {
      ok: true as const,
      mode: config.status as 'active' | 'manual',
    };
  }

  // ── Worker claim / progress ─────────────────────────────────────

  async claimJobs(workerId: string, limitRaw?: number) {
    const limit = Math.min(10, Math.max(1, Number(limitRaw) || 3));
    const worker = String(workerId || 'worker').slice(0, 120);
    const staleBefore = new Date(Date.now() - 30 * 60 * 1000);

    const candidates = await this.jobRepo.find({
      where: { state: In(WORKER_CLAIMABLE_STATES) },
      order: { updatedAt: 'ASC' },
      take: limit * 3,
      relations: { anime: true },
    });

    const claimed: AutomationJob[] = [];
    for (const job of candidates) {
      if (claimed.length >= limit) break;
      const stale =
        !job.claimedAt ||
        job.claimedAt < staleBefore ||
        job.claimedBy === worker;
      if (job.claimedBy && job.claimedBy !== worker && !stale) continue;

      job.claimedAt = new Date();
      job.claimedBy = worker;
      job.updatedAt = new Date();
      await this.jobRepo.save(job);
      claimed.push(job);
    }

    const profiles = new Map<string, AnimeSourceProfile>();
    const submissions = new Map<string, SubtitleSubmission>();
    for (const j of claimed) {
      if (!profiles.has(j.animeId)) {
        const p = await this.profileRepo.findOne({
          where: { animeId: j.animeId },
        });
        if (p) profiles.set(j.animeId, p);
      }
      if (j.subtitleSubmissionId && !submissions.has(j.subtitleSubmissionId)) {
        const s = await this.subRepo.findOne({
          where: { id: j.subtitleSubmissionId },
        });
        if (s) submissions.set(j.subtitleSubmissionId, s);
      }
    }

    return {
      items: claimed.map((j) => {
        const sub = j.subtitleSubmissionId
          ? submissions.get(j.subtitleSubmissionId)
          : null;
        return {
          ...this.toJobDto(j, j.anime),
          source_profile: profiles.get(j.animeId)
            ? this.toProfileDto(profiles.get(j.animeId)!)
            : null,
          subtitle: sub
            ? {
                id: sub.id,
                telegram_file_id: sub.telegramFileId,
                original_file_name: sub.originalFileName,
                telegram_chat_id: sub.telegramChatId,
                telegram_message_id: sub.telegramMessageId,
                stored_path: sub.storedPath,
              }
            : null,
        };
      }),
    };
  }

  async workerProgress(
    id: string,
    body: {
      state?: AutomationJobState;
      message?: string;
      progress?: Record<string, unknown>;
      error_message?: string;
      error_code?: string;
      selected_release_name?: string;
      selected_magnet?: string;
      torrent_hash?: string;
      download_path?: string;
      output_path?: string;
      output_file_name?: string;
      archive_file_key?: string;
      download_link?: string;
      release_candidates?: unknown[];
      create_draft?: boolean;
    },
  ) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');

    const patch: Partial<AutomationJob> = {};
    if (body.progress) {
      const prevLive = job.progress?.tg_live;
      patch.progress = { ...(job.progress ?? {}), ...body.progress };
      // Worker patches must not wipe the live Telegram card bookkeeping.
      if (
        prevLive &&
        !(body.progress as { tg_live?: unknown }).tg_live &&
        patch.progress
      ) {
        (patch.progress as Record<string, unknown>).tg_live = prevLive;
      }
    }
    if (body.selected_release_name != null)
      patch.selectedReleaseName = body.selected_release_name;
    if (body.selected_magnet != null) patch.selectedMagnet = body.selected_magnet;
    if (body.torrent_hash != null) patch.torrentHash = body.torrent_hash;
    if (body.download_path != null) patch.downloadPath = body.download_path;
    if (body.output_path != null) patch.outputPath = body.output_path;
    if (body.output_file_name != null)
      patch.outputFileName = body.output_file_name;
    if (body.archive_file_key != null)
      patch.archiveFileKey = body.archive_file_key;
    if (body.download_link != null) patch.downloadLink = body.download_link;
    if (body.release_candidates) patch.releaseCandidates = body.release_candidates;
    if (body.error_message != null) patch.errorMessage = body.error_message;
    if (body.error_code != null) patch.errorCode = body.error_code;

    let result;
    if (body.state) {
      result = await this.transitionJob(id, body.state, {
        message: body.message,
        patch,
      });
    } else {
      Object.assign(job, patch);
      job.updatedAt = new Date();
      result = this.toJobDto(await this.jobRepo.save(job));
      if (body.message) {
        await this.eventRepo.save(
          this.eventRepo.create({
            jobId: id,
            fromState: job.state,
            toState: job.state,
            message: body.message,
            meta: body.progress ?? {},
          }),
        );
      }
    }

    // After LINKED, optionally queue channel draft
    if (
      body.state === 'LINKED' &&
      body.download_link &&
      body.create_draft !== false
    ) {
      try {
        const draft = await this.channelDrafts.completeSoftsub({
          anime_id: job.animeId,
          episode_number: Number(job.episodeNumber),
          download_link: body.download_link,
          create_draft: true,
        });
        const draftId =
          (draft as { draft?: { draft?: { id?: string }; id?: string } })?.draft
            ?.draft?.id ??
          (draft as { draft?: { id?: string } })?.draft?.id ??
          null;
        await this.transitionJob(id, 'DRAFT_QUEUED', {
          message: 'channel draft queued',
          patch: {
            draftId: draftId ?? undefined,
            downloadLink: body.download_link,
          },
        });
        await this.transitionJob(id, 'AWAITING_APPROVAL', {
          message: 'awaiting admin approval',
        });
        result = (await this.getJob(id)).job;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        this.logger.warn(`draft queue failed job=${id}: ${msg}`);
        await this.transitionJob(id, 'NEEDS_REVIEW', {
          message: `linked but draft failed: ${msg}`,
          patch: { errorMessage: msg },
        });
        result = (await this.getJob(id)).job;
      }
    }

    return { ok: true as const, job: result };
  }

  // ── helpers ─────────────────────────────────────────────────────

  private async requireAnime(id: string) {
    const anime = await this.animeRepo.findOne({ where: { id } });
    if (!anime) throw new NotFoundException('Anime not found');
    return anime;
  }

  private async ensureConfig(animeId: string) {
    let config = await this.configRepo.findOne({ where: { animeId } });
    if (!config) {
      config = await this.configRepo.save(
        this.configRepo.create({ animeId, status: 'disabled' }),
      );
    }
    return config;
  }

  /**
   * Default ordered chain: ASW first, then Judas.
   * Other encoders only via per-anime profile (streaming / self-encode titles).
   */
  private static readonly DEFAULT_PREFERRED_GROUPS = ['ASW', 'Judas'];

  private static readonly DEFAULT_FALLBACK_GROUPS: string[] = [];

  private buildDefaultAltTitles(anime: Anime): string[] {
    const out: string[] = [];
    const push = (raw: string | null | undefined) => {
      const s = String(raw ?? '')
        .trim()
        .replace(/\s+/g, ' ');
      if (!s) return;
      if (!out.some((x) => x.toLowerCase() === s.toLowerCase())) out.push(s);
    };

    push(anime.titleRomaji);
    if (anime.slug) {
      const fromSlug = anime.slug
        .replace(/-/g, ' ')
        .replace(/\s+season\s+\d+/gi, '')
        .replace(/\s+s\d+\b/gi, '')
        .trim();
      if (fromSlug) {
        push(
          fromSlug.replace(/\b\w/g, (c) => c.toUpperCase()),
        );
      }
    }
    const title = String(anime.title ?? '').trim();
    if (title && title.split(/\s+/).length <= 6) push(title);
    // Shorten very long English titles to first 4 words as a search hint
    if (title && title.split(/\s+/).length > 6) {
      push(title.split(/\s+/).slice(0, 4).join(' '));
    }
    return out;
  }

  private async ensureProfile(animeId: string, anime?: Anime) {
    let profile = await this.profileRepo.findOne({ where: { animeId } });
    const a = anime ?? (await this.requireAnime(animeId));
    if (!profile) {
      profile = await this.profileRepo.save(
        this.profileRepo.create({
          animeId,
          canonicalTitle: a.titleRomaji || a.title,
          altTitles: this.buildDefaultAltTitles(a),
          preferredGroups: [...AutomationService.DEFAULT_PREFERRED_GROUPS],
          fallbackGroups: [...AutomationService.DEFAULT_FALLBACK_GROUPS],
          preferredResolution: '1080p',
          preferredCodec: 'hevc',
          selectionMode: 'prefer_group',
        }),
      );
      return profile;
    }

    // Fill thin profiles without overwriting admin-tuned fields
    let dirty = false;
    if (!profile.canonicalTitle) {
      profile.canonicalTitle = a.titleRomaji || a.title;
      dirty = true;
    }
    if (!profile.altTitles?.length) {
      profile.altTitles = this.buildDefaultAltTitles(a);
      dirty = true;
    }
    if (!profile.preferredGroups?.length) {
      profile.preferredGroups = [
        ...AutomationService.DEFAULT_PREFERRED_GROUPS,
      ];
      dirty = true;
    }
    if (!profile.fallbackGroups?.length) {
      profile.fallbackGroups = [...AutomationService.DEFAULT_FALLBACK_GROUPS];
      dirty = true;
    }
    if (dirty) {
      profile = await this.profileRepo.save(profile);
    }
    return profile;
  }

  private async touchConfigJob(animeId: string, episodeNumber: number) {
    const config = await this.ensureConfig(animeId);
    config.lastJobAt = new Date();
    config.lastProcessedEpisode = episodeNumber;
    config.lastError = null;
    await this.configRepo.save(config);
  }

  private async resolveAnimeByTitle(title: string) {
    const t = title.trim();
    if (!t) return { anime: null, note: 'empty_title' };

    const exact = await this.animeRepo
      .createQueryBuilder('a')
      .where(
        '(LOWER(TRIM(a.title)) = LOWER(:t) OR LOWER(TRIM(a.title_romaji)) = LOWER(:t))',
        { t },
      )
      .getMany();
    if (exact.length === 1) {
      return { anime: exact[0], note: 'exact_title' };
    }
    if (exact.length > 1) {
      return { anime: null, note: `ambiguous_exact:${exact.length}` };
    }

    // Dedicated subtitle_title, then alt_titles / canonical_title
    const byAlt = await this.profileRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.anime', 'a')
      .where(
        `(
          LOWER(TRIM(COALESCE(p.extra->>'subtitle_title', ''))) = LOWER(:t)
          OR LOWER(TRIM(COALESCE(p.canonical_title, ''))) = LOWER(:t)
          OR EXISTS (
            SELECT 1
            FROM jsonb_array_elements_text(COALESCE(p.alt_titles, '[]'::jsonb)) AS alt(val)
            WHERE LOWER(TRIM(alt.val)) = LOWER(:t)
          )
        )`,
        { t },
      )
      .getMany();

    if (byAlt.length === 1) {
      return { anime: byAlt[0].anime, note: 'source_profile_alt' };
    }
    if (byAlt.length > 1) {
      return { anime: null, note: `ambiguous_alt:${byAlt.length}` };
    }

    const fuzzy = await this.animeRepo
      .createQueryBuilder('a')
      .where(
        '(a.title ILIKE :q OR a.title_romaji ILIKE :q OR a.slug ILIKE :q)',
        { q: `%${t}%` },
      )
      .take(5)
      .getMany();
    if (fuzzy.length === 1) {
      return { anime: fuzzy[0], note: 'fuzzy_unique' };
    }
    if (fuzzy.length > 1) {
      return { anime: null, note: `ambiguous_fuzzy:${fuzzy.length}` };
    }
    return { anime: null, note: 'not_found' };
  }

  /**
   * Bump a single editable Telegram status card (tel-bot sends/edits + ack).
   * Stored on job.progress.tg_live — not a flood of new DMs.
   */
  private async queueLiveStatus(
    job: AutomationJob,
    opts: { message?: string; fromState?: AutomationJobState | null } = {},
  ): Promise<AutomationJob> {
    const anime =
      (await this.animeRepo.findOne({ where: { id: job.animeId } })) ?? null;
    const html = this.buildLiveStatusHtml(job, anime, opts);
    const prev = (job.progress?.tg_live ?? {}) as Record<string, unknown>;
    const prevRev = Number(prev.rev) || 0;
    const messages =
      prev.messages && typeof prev.messages === 'object' && prev.messages
        ? (prev.messages as Record<string, number>)
        : {};
    const deliveredRev = Number(prev.delivered_rev) || 0;

    job.progress = {
      ...(job.progress ?? {}),
      tg_live: {
        html,
        rev: prevRev + 1,
        delivered_rev: deliveredRev,
        messages,
        updated_at: new Date().toISOString(),
      },
    };
    job.updatedAt = new Date();
    return this.jobRepo.save(job);
  }

  private buildLiveStatusHtml(
    job: AutomationJob,
    anime: Anime | null,
    opts: { message?: string; fromState?: AutomationJobState | null } = {},
  ) {
    const state = job.state;
    const stateFa = JOB_STATE_FA[state] || state;
    const title = anime?.title || anime?.titleRomaji || anime?.slug || '—';
    const pct = STAGE_PCT[state] ?? 10;
    const filled = Math.round(Math.min(10, Math.max(0, pct) / 10));
    const bar = '▓'.repeat(filled) + '░'.repeat(10 - filled);
    const trigger = TRIGGER_FA[String(job.triggerSource ?? '')] || 'اتوماسیون';
    const hint =
      STAGE_HINT_FA[state] ||
      this.persianizeWorkerMessage(opts.message) ||
      '';

    const epNum = Number(job.episodeNumber);
    const epLabel = Number.isFinite(epNum)
      ? Math.round(epNum * 100) % 100 === 0
        ? String(Math.round(epNum))
        : String(epNum)
      : String(job.episodeNumber ?? '');

    const lines = [
      `🎬 <b>اتوماسیون سافت‌ساب</b>`,
      `<b>${this.escapeHtml(title)}</b> — قسمت ${this.escapeHtml(epLabel)}`,
      ``,
      `<b>${this.escapeHtml(stateFa)}</b>`,
      `<code>${bar}</code> ${pct}٪`,
    ];
    if (hint) lines.push(this.escapeHtml(hint));
    lines.push(`منبع: ${this.escapeHtml(trigger)}`);
    if (job.selectedReleaseName) {
      lines.push(
        `ریلیز: <code>${this.escapeHtml(job.selectedReleaseName)}</code>`,
      );
    }
    if (job.outputFileName) {
      lines.push(
        `خروجی: <code>${this.escapeHtml(job.outputFileName)}</code>`,
      );
    }
    if (job.errorMessage) {
      lines.push(
        `⚠️ ${this.escapeHtml(this.persianizeWorkerMessage(job.errorMessage) || job.errorMessage)}`,
      );
    }
    return lines.join('\n');
  }

  /** Soften common English worker/API messages for admin DMs. */
  private persianizeWorkerMessage(raw?: string | null): string | null {
    const s = String(raw ?? '').trim();
    if (!s) return null;
    if (/local bot api|telegramApiRoot|>\s*50\s*mb/i.test(s)) {
      return 'فایل حجیم است — آپلود دستی به کانال آرشیو لازم است';
    }
    if (/awaiting admin approval/i.test(s)) {
      return 'پیش‌نویس آماده است — منتظر تأیید شما';
    }
    if (/searching releases|subtitle triggered/i.test(s)) {
      return null;
    }
    if (/nyaa/i.test(s) && /miss|exhaust|0 magnet/i.test(s)) {
      return 'ریلیز مناسب روی Nyaa پیدا نشد';
    }
    if (/channel draft queued/i.test(s)) return 'پیش‌نویس کانال در صف است';
    if (/manual_mode/i.test(s)) return 'حالت دستی — منتظر ادمین';
    // Drop raw English transition noise
    if (/^[A-Z_]+$/.test(s) || /^state →/i.test(s)) return null;
    if (/^[A-Za-z0-9 _\-→>.]+$/.test(s) && /[A-Z]{3,}/.test(s)) {
      return null;
    }
    return s;
  }

  /**
   * Tel-bot: atomically claim live-status updates so intake sync + poller
   * cannot both send a fresh Telegram message for the same rev.
   */
  async claimPendingLiveStatus(opts?: {
    limit?: number;
    jobId?: string;
  }) {
    const limit = Math.min(Math.max(Number(opts?.limit) || 15, 1), 40);
    const onlyJobId = String(opts?.jobId ?? '').trim() || null;

    return this.jobRepo.manager.transaction(async (manager) => {
      // Lock jobs only (no outer join — Postgres rejects FOR UPDATE with LEFT JOIN).
      const qb = manager
        .getRepository(AutomationJob)
        .createQueryBuilder('j')
        .setLock('pessimistic_write')
        .where("j.progress->'tg_live'->>'rev' IS NOT NULL")
        .andWhere(
          `(
            j.progress->'tg_live'->>'delivered_rev' IS NULL
            OR NULLIF(j.progress->'tg_live'->>'delivered_rev', '') IS NULL
            OR (j.progress->'tg_live'->>'rev')::int >
               COALESCE((j.progress->'tg_live'->>'delivered_rev')::int, 0)
          )`,
        )
        .orderBy('j.updatedAt', 'ASC')
        .take(limit);

      if (onlyJobId) {
        qb.andWhere('j.id = :onlyJobId', { onlyJobId });
      }

      const rows = await qb.getMany();
      const animeIds = [...new Set(rows.map((j) => j.animeId).filter(Boolean))];
      const animes = animeIds.length
        ? await manager.getRepository(Anime).find({
            where: { id: In(animeIds) },
          })
        : [];
      const animeById = new Map(animes.map((a) => [a.id, a]));

      const items: Array<{
        job_id: string;
        rev: number;
        html: string;
        messages: Record<string, number>;
        restore_delivered_rev: number;
        anime_title: string | null;
        anime_id: string | null;
        episode_number: number;
        state: string;
        draft_id: string | null;
      }> = [];

      for (const j of rows) {
        const live = {
          ...((j.progress?.tg_live ?? {}) as Record<string, unknown>),
        };
        const rev = Number(live.rev) || 0;
        const prevDelivered = Number(live.delivered_rev) || 0;
        if (rev < 1 || rev <= prevDelivered) continue;

        live.delivered_rev = rev; // claim — concurrent callers skip this rev
        j.progress = { ...(j.progress ?? {}), tg_live: live };
        j.updatedAt = new Date();
        await manager.save(j);

        items.push({
          job_id: j.id,
          rev,
          html: String(live.html ?? ''),
          messages:
            live.messages && typeof live.messages === 'object'
              ? { ...(live.messages as Record<string, number>) }
              : {},
          restore_delivered_rev: prevDelivered,
          anime_title: animeById.get(j.animeId)?.title ?? null,
          anime_id: j.animeId ?? null,
          episode_number: Number(j.episodeNumber),
          state: j.state,
          draft_id: j.draftId ?? null,
        });
      }

      return { items };
    });
  }

  /** Older tel-bot builds called GET pending-status — same claim semantics now. */
  async listPendingLiveStatus(limitRaw?: number) {
    return this.claimPendingLiveStatus({ limit: limitRaw });
  }

  async ackLiveStatus(
    id: string,
    body: {
      rev?: number;
      messages?: Record<string, number | string>;
      /** Roll back claim when Telegram send/edit failed. */
      release?: boolean;
      restore_delivered_rev?: number;
    },
  ) {
    const job = await this.jobRepo.findOne({ where: { id } });
    if (!job) throw new NotFoundException('Job not found');
    const live = {
      ...((job.progress?.tg_live ?? {}) as Record<string, unknown>),
    };
    const currentRev = Number(live.rev) || 0;
    const ackRev = Number(body.rev);
    if (!Number.isFinite(ackRev) || ackRev < 1) {
      throw new BadRequestException('rev required');
    }

    if (body.release) {
      const restore = Number(body.restore_delivered_rev);
      const delivered = Number(live.delivered_rev) || 0;
      // Only unwind if we still own this claimed rev and nothing newer arrived.
      if (delivered === ackRev && currentRev === ackRev) {
        live.delivered_rev = Number.isFinite(restore) ? Math.max(0, restore) : 0;
        job.progress = { ...(job.progress ?? {}), tg_live: live };
        job.updatedAt = new Date();
        await this.jobRepo.save(job);
      }
      return { ok: true as const, released: true as const };
    }

    const prevMessages =
      live.messages && typeof live.messages === 'object'
        ? { ...(live.messages as Record<string, number>) }
        : {};
    const incoming = body.messages ?? {};
    for (const [chatId, msgId] of Object.entries(incoming)) {
      const n = Number(msgId);
      if (chatId && Number.isFinite(n) && n > 0) prevMessages[String(chatId)] = n;
    }

    // Claim already set delivered_rev; merge message ids. If a newer rev
    // landed mid-send, leave delivered behind current so poller retries.
    const delivered = Number(live.delivered_rev) || 0;
    live.messages = prevMessages;
    if (ackRev >= delivered) {
      live.delivered_rev = Math.min(ackRev, currentRev || ackRev);
    }
    job.progress = { ...(job.progress ?? {}), tg_live: live };
    await this.jobRepo.save(job);
    return { ok: true as const, delivered_rev: live.delivered_rev };
  }

  private escapeHtml(s: string) {
    return String(s ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  private asNumberArray(v: unknown): number[] {
    if (!Array.isArray(v)) return [];
    return v.map(Number).filter((n) => Number.isFinite(n));
  }

  private asStringArray(v: unknown): string[] {
    if (!Array.isArray(v)) return [];
    return v.map((x) => String(x).trim()).filter(Boolean);
  }

  private toConfigDto(c: AnimeAutomationConfig, anime?: Anime | null) {
    return {
      id: c.id,
      anime_id: c.animeId,
      anime_title: anime?.title ?? null,
      anime_slug: anime?.slug ?? null,
      status: c.status,
      trigger_mode: c.triggerMode,
      new_episode_trigger_enabled: c.newEpisodeTriggerEnabled,
      start_episode: c.startEpisode,
      end_episode: c.endEpisode,
      excluded_episodes: c.excludedEpisodes ?? [],
      enabled_seasons: c.enabledSeasons ?? [],
      processing_method: c.processingMethod,
      last_error: c.lastError,
      last_processed_episode: c.lastProcessedEpisode,
      last_job_at: c.lastJobAt?.toISOString?.() ?? null,
      updated_at: c.updatedAt?.toISOString?.() ?? null,
    };
  }

  private toProfileDto(p: AnimeSourceProfile) {
    const extra = (p.extra ?? {}) as Record<string, unknown>;
    const offset = Number(extra.episode_search_offset);
    const season = Number(extra.search_season);
    const outputTitle = String(extra.output_title ?? '').trim();
    const subtitleTitle = String(extra.subtitle_title ?? '').trim();
    return {
      id: p.id,
      anime_id: p.animeId,
      canonical_title: p.canonicalTitle,
      alt_titles: p.altTitles ?? [],
      streaming_platform: p.streamingPlatform,
      preferred_groups: p.preferredGroups ?? [],
      fallback_groups: p.fallbackGroups ?? [],
      preferred_resolution: p.preferredResolution,
      preferred_codec: p.preferredCodec,
      preferred_bit_depth: p.preferredBitDepth,
      max_file_size_bytes: p.maxFileSizeBytes,
      allowed_providers: p.allowedProviders ?? [],
      search_patterns: p.searchPatterns ?? [],
      excluded_keywords: p.excludedKeywords ?? [],
      selection_mode: p.selectionMode,
      custom_encoding_enabled: p.customEncodingEnabled,
      handbrake_preset: p.handbrakePreset,
      subtitle_default: p.subtitleDefault,
      subtitle_forced: p.subtitleForced,
      episode_search_offset: Number.isFinite(offset) ? offset : 0,
      search_season: Number.isFinite(season) && season > 0 ? season : null,
      /** Expected translator-file title segment (e.g. BLEACH Sennen Kessen-hen P4). */
      subtitle_title: subtitleTitle || null,
      /** Title segment for [Shiori] {output_title} - {ep} [1080p …].mkv */
      output_title: outputTitle || null,
      extra,
    };
  }

  private toJobDto(j: AutomationJob, anime?: Anime | null) {
    return {
      id: j.id,
      idempotency_key: j.idempotencyKey,
      anime_id: j.animeId,
      anime_title: anime?.title ?? null,
      anime_slug: anime?.slug ?? null,
      episode_number: Number(j.episodeNumber),
      season_number: j.seasonNumber,
      state: j.state,
      trigger_source: j.triggerSource,
      subtitle_submission_id: j.subtitleSubmissionId,
      selected_release_name: j.selectedReleaseName,
      selected_magnet: j.selectedMagnet,
      torrent_hash: j.torrentHash,
      download_path: j.downloadPath,
      output_path: j.outputPath,
      output_file_name: j.outputFileName,
      archive_file_key: j.archiveFileKey,
      download_link: j.downloadLink,
      draft_id: j.draftId ?? null,
      release_candidates: j.releaseCandidates ?? [],
      progress: j.progress ?? {},
      error_message: j.errorMessage,
      error_code: j.errorCode,
      attempt_count: j.attemptCount,
      claimed_at: j.claimedAt?.toISOString?.() ?? null,
      claimed_by: j.claimedBy,
      created_at: j.createdAt?.toISOString?.() ?? null,
      updated_at: j.updatedAt?.toISOString?.() ?? null,
    };
  }

  private toSubmissionDto(s: SubtitleSubmission) {
    return {
      id: s.id,
      anime_id: s.animeId,
      episode_number: s.episodeNumber != null ? Number(s.episodeNumber) : null,
      filename_title: s.filenameTitle,
      original_file_name: s.originalFileName,
      telegram_file_id: s.telegramFileId,
      telegram_message_id: s.telegramMessageId,
      telegram_chat_id: s.telegramChatId,
      content_hash: s.contentHash,
      revision: s.revision,
      stored_path: s.storedPath,
      status: s.status,
      match_note: s.matchNote,
      created_at: s.createdAt?.toISOString?.() ?? null,
    };
  }
}
