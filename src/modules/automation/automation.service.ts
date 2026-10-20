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
  TelegramUser,
} from '../../entities';
import type { AutomationJobState } from '../../entities/automation-job.entity';
import type { AutomationStatus } from '../../entities/anime-automation-config.entity';
import { ChannelDraftsService } from '../bot/channel-drafts.service';
import { TelegramDmOutboxService } from '../telegram-dm/telegram-dm-outbox.service';
import { canTransition, WORKER_CLAIMABLE_STATES } from './automation.states';

/** States that warrant an admin Telegram status DM (dash-like summary). */
const ADMIN_NOTIFY_STATES = new Set<AutomationJobState>([
  'AWAITING_SELECTION',
  'NEEDS_REVIEW',
  'AWAITING_MANUAL_ARCHIVE',
  'WAITING_FOR_SUBTITLE',
  'FAILED',
  'AWAITING_APPROVAL',
  'PUBLISHED',
]);

const JOB_STATE_FA: Record<string, string> = {
  ELIGIBLE: 'آماده اجرا',
  SEARCHING: 'جستجوی ریلیز',
  AWAITING_SELECTION: 'انتخاب ریلیز',
  DOWNLOAD_QUEUED: 'صف دانلود',
  DOWNLOADING: 'در حال دانلود',
  DOWNLOADED: 'دانلود شد',
  WAITING_FOR_SUBTITLE: 'منتظر ساب',
  MUXING: 'مکس ساب',
  READY_FOR_ARCHIVE: 'آماده آرشیو',
  AWAITING_MANUAL_ARCHIVE: 'آرشیو دستی',
  ARCHIVING: 'آپلود آرشیو',
  LINKED: 'لینک شد',
  AWAITING_APPROVAL: 'منتظر تأیید',
  PUBLISHED: 'منتشر شد',
  NEEDS_REVIEW: 'نیاز به بررسی',
  FAILED: 'ناموفق',
  CANCELLED: 'لغو شده',
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
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    private readonly channelDrafts: ChannelDraftsService,
    private readonly telegramDmOutbox: TelegramDmOutboxService,
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
    const dto = this.toJobDto(saved);
    if (
      !opts.skipAdminNotify &&
      from !== toState &&
      ADMIN_NOTIFY_STATES.has(toState)
    ) {
      void this.notifyAdminsJobStatus(saved, {
        message: opts.message,
        fromState: from,
      }).catch((err) =>
        this.logger.warn(
          `admin job notify failed: ${
            err instanceof Error ? err.message : String(err)
          }`,
        ),
      );
    }
    return dto;
  }

  async cancelJob(id: string) {
    return this.transitionJob(id, 'CANCELLED', { message: 'cancelled by admin' });
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
      return {
        ok: true as const,
        duplicate: true as const,
        submission: this.toSubmissionDto(existing),
        job: null,
      };
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
      return {
        ok: true as const,
        duplicate: false as const,
        submission: this.toSubmissionDto(submission),
        job: this.toJobDto(created.job, anime),
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
    return {
      ok: true as const,
      duplicate: false as const,
      submission: this.toSubmissionDto(submission),
      job: this.toJobDto(created.job, anime),
      reattached: created.reattached,
    };
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

    // supersede older open jobs for same ep
    const open = await this.jobRepo.find({
      where: {
        animeId,
        episodeNumber,
        state: In([
          'ELIGIBLE',
          'SEARCHING',
          'AWAITING_SELECTION',
          'DOWNLOAD_QUEUED',
          'NEEDS_REVIEW',
        ]),
      },
    });
    for (const j of open) {
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
      patch.progress = { ...(job.progress ?? {}), ...body.progress };
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

  /** Default fansub groups used when profile has none — reduces manual magnet. */
  private static readonly DEFAULT_PREFERRED_GROUPS = [
    'ASW',
    'Judas',
    'Erai-raws',
    'SubsPlease',
  ];

  private static readonly DEFAULT_FALLBACK_GROUPS = ['HorribleSubs', 'CameEsp'];

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
          selectionMode: 'auto',
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

    // Source-profile short names (alt_titles / canonical_title) for long catalog titles
    const byAlt = await this.profileRepo
      .createQueryBuilder('p')
      .innerJoinAndSelect('p.anime', 'a')
      .where(
        `(
          LOWER(TRIM(COALESCE(p.canonical_title, ''))) = LOWER(:t)
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
   * Queue admin DMs (via tel-bot outbox) with a dash-like job status card.
   * Used for attention / terminal milestones — intake start is notified by tel-bot directly.
   */
  private async notifyAdminsJobStatus(
    job: AutomationJob,
    opts: { message?: string; fromState?: AutomationJobState | null } = {},
  ) {
    const recipients = await this.resolveAutomationAdminIds();
    if (!recipients.length) return;

    const anime =
      (await this.animeRepo.findOne({ where: { id: job.animeId } })) ?? null;
    const state = job.state;
    const stateFa = JOB_STATE_FA[state] || state;
    const title = anime?.title || anime?.titleRomaji || anime?.slug || '—';
    const dashBase =
      this.config.get<string>('dash.baseUrl') || 'https://dash.shiori.cloud';
    const dashUrl = `${dashBase}/admin/automation/jobs/${job.id}`;

    const lines = [
      `🎬 <b>اتوماسیون سافت‌ساب</b>`,
      `<b>${this.escapeHtml(title)}</b> — قسمت <code>${this.escapeHtml(
        String(job.episodeNumber),
      )}</code>`,
      `وضعیت: <b>${this.escapeHtml(stateFa)}</b> <code>${this.escapeHtml(
        state,
      )}</code>`,
    ];
    if (opts.fromState && opts.fromState !== state) {
      lines.push(
        `انتقال: <code>${this.escapeHtml(opts.fromState)}</code> → <code>${this.escapeHtml(
          state,
        )}</code>`,
      );
    }
    if (opts.message) {
      lines.push(this.escapeHtml(opts.message));
    }
    if (job.errorMessage) {
      lines.push(
        `خطا: <code>${this.escapeHtml(job.errorMessage)}</code>`,
      );
    }
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
    lines.push(`<a href="${this.escapeHtml(dashUrl)}">باز کردن در داشبورد</a>`);

    const text = lines.join('\n');
    await this.telegramDmOutbox.enqueueMany(
      recipients.map((chatId) => ({ chatId, text })),
    );
  }

  private async resolveAutomationAdminIds(): Promise<number[]> {
    const ids = new Set<number>();
    const raw = String(
      this.config.get<string>('telegram.adminUserId') ?? '',
    ).trim();
    if (raw) {
      for (const part of raw.split(/[,;\s]+/)) {
        const n = Number(part.trim());
        if (Number.isFinite(n) && n > 0) ids.add(n);
      }
    }
    const staff = await this.usersRepo
      .createQueryBuilder('u')
      .select('u.telegram_user_id', 'telegram_user_id')
      .where("u.app_role IN ('admin', 'moderator')")
      .andWhere('u.is_banned = false')
      .getRawMany<{ telegram_user_id: string }>();
    for (const row of staff) {
      const n = Number(row.telegram_user_id);
      if (Number.isFinite(n) && n > 0) ids.add(n);
    }
    return [...ids];
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
      extra: p.extra ?? {},
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
      draft_id: j.draftId,
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
