import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, Repository } from 'typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeSubtitle,
  ChannelPostDraft,
} from '../../entities';
import {
  buildEpisodeCaptionLine,
  buildMiniAppEpisodesUrl,
  captionEntitiesToHtml,
  repairTgEmojiHtml,
  repairHtmlCaption,
  replaceEpisodeLinesInCaption,
  upgradeKnownEmojisToPremiumHtml,
  upgradeSeasonEpisodePackEmoji,
  type TelegramMessageEntity,
} from './channel-caption.util';

export type BindChannelTemplateDto = {
  animeIdOrSlug: string;
  coverFileId: string;
  captionHtml?: string;
  captionText?: string;
  captionEntities?: TelegramMessageEntity[];
  channelId: string;
  channelMessageId?: number | string | null;
};

@Injectable()
export class ChannelDraftsService {
  private readonly logger = new Logger(ChannelDraftsService.name);

  constructor(
    @InjectRepository(Anime) private readonly animeRepo: Repository<Anime>,
    @InjectRepository(AnimeEpisode)
    private readonly episodeRepo: Repository<AnimeEpisode>,
    @InjectRepository(AnimeSubtitle)
    private readonly subtitleRepo: Repository<AnimeSubtitle>,
    @InjectRepository(ChannelPostDraft)
    private readonly draftRepo: Repository<ChannelPostDraft>,
    private readonly config: ConfigService,
  ) {}

  private async resolveAnime(idOrSlug: string): Promise<Anime> {
    const key = String(idOrSlug ?? '').trim();
    if (!key) throw new BadRequestException('anime id/slug required');

    const uuidRe =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (uuidRe.test(key)) {
      const byId = await this.animeRepo.findOne({ where: { id: key } });
      if (byId) return byId;
    }

    const bySlug = await this.animeRepo.findOne({ where: { slug: key } });
    if (bySlug) return bySlug;

    throw new NotFoundException('Anime not found');
  }

  private adminUserIds(): number[] {
    const raw = String(this.config.get<string>('telegram.adminUserId') ?? '').trim();
    if (!raw) return [];
    return raw
      .split(/[,;\s]+/)
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n) && n > 0);
  }

  /** Primary admin (first configured id). */
  private adminUserId(): number | null {
    return this.adminUserIds()[0] ?? null;
  }

  private postsChannelId(anime?: Anime | null): string {
    const fromAnime = String(anime?.channelId ?? '').trim();
    if (fromAnime) return fromAnime;
    return String(this.config.get<string>('telegram.postsChannelId') ?? '').trim();
  }

  private miniAppBotUsername(): string {
    return (
      this.config.get<string>('telegram.miniAppBotUsername')?.trim() ||
      'ShioriMiniBot'
    );
  }

  private draftKeyboard(draftId: string, animeId: string) {
    const miniUrl = buildMiniAppEpisodesUrl(this.miniAppBotUsername(), animeId);
    const successId =
      process.env.CUSTOM_EMOJI_SUCCESS?.trim() || '5206607081334906820';
    const stopId =
      process.env.CUSTOM_EMOJI_STOP?.trim() || '5260293700088511294';
    return {
      inline_keyboard: [
        [
          {
            text: 'انتشار در کانال',
            callback_data: `chdraft_ok_${draftId}`,
            icon_custom_emoji_id: successId,
          },
          {
            text: 'رد',
            callback_data: `chdraft_no_${draftId}`,
            icon_custom_emoji_id: stopId,
          },
        ],
        [
          {
            text: 'دانلود از مینی‌اپ',
            url: miniUrl,
          },
        ],
      ],
    };
  }

  private shouldAttachMiniAppButton(channelId: string): boolean {
    const main = String(
      this.config.get<string>('telegram.postsChannelId') ?? '',
    ).trim();
    // Main TheShioriSub posts: no glass mini-app button until launch.
    if (main && channelId === main) return false;
    return true;
  }

  private channelKeyboard(animeId: string) {
    return {
      inline_keyboard: [
        [
          {
            text: 'دانلود از مینی‌اپ',
            url: buildMiniAppEpisodesUrl(this.miniAppBotUsername(), animeId),
          },
        ],
      ],
    };
  }

  toDraftDto(draft: ChannelPostDraft, anime?: Anime | null) {
    return {
      id: draft.id,
      anime_id: draft.animeId,
      anime_slug: anime?.slug ?? null,
      anime_title: anime?.title ?? null,
      episode_number: draft.episodeNumber,
      proposed_caption: draft.proposedCaption,
      cover_file_id: draft.coverFileId,
      status: draft.status,
      admin_preview_message_id: draft.adminPreviewMessageId,
      admin_preview_chat_id: draft.adminPreviewChatId,
      published_message_id: draft.publishedMessageId,
      channel_id: anime?.channelId ?? this.postsChannelId(anime),
      created_at: draft.createdAt?.toISOString?.() ?? null,
    };
  }

  /**
   * Lightweight anime search for bot bind picker.
   * Matches title / title_romaji / slug (ILIKE).
   */
  async searchAnime(query: string, limitRaw?: number) {
    const q = String(query ?? '').trim();
    if (!q) {
      throw new BadRequestException('query required');
    }

    const limit = Math.min(20, Math.max(1, Number(limitRaw) || 8));
    const pattern = `%${q}%`;

    const rows = await this.animeRepo
      .createQueryBuilder('a')
      .select([
        'a.id',
        'a.slug',
        'a.title',
        'a.year',
        'a.coverImage',
        'a.channelCoverFileId',
        'a.channelCaptionHtml',
      ])
      .where(
        '(a.title ILIKE :q OR a.title_romaji ILIKE :q OR a.slug ILIKE :q)',
        { q: pattern },
      )
      .orderBy('a.updatedAt', 'DESC')
      .take(limit)
      .getMany();

    return {
      items: rows.map((a) => ({
        id: a.id,
        slug: a.slug,
        title: a.title,
        year: a.year,
        cover_image: a.coverImage,
        has_channel_template: Boolean(
          a.channelCoverFileId && a.channelCaptionHtml,
        ),
      })),
    };
  }

  /**
   * Resolve mini-app keyboard for a channel photo post (hidden forwards included).
   */
  async resolveMiniAppMarkup(body: {
    caption?: string;
    origin_channel_id?: string;
    originChannelId?: string;
    origin_message_id?: string | number;
    originMessageId?: string | number;
  }) {
    const originChat = String(
      body.origin_channel_id ?? body.originChannelId ?? '',
    ).trim();
    const originMsg = String(
      body.origin_message_id ?? body.originMessageId ?? '',
    ).trim();

    if (originChat && originMsg) {
      const byBind = await this.animeRepo.findOne({
        where: {
          channelId: originChat,
          channelLatestMessageId: originMsg,
        },
      });
      if (byBind) {
        return {
          matched: true as const,
          anime_id: byBind.id,
          slug: byBind.slug,
          reply_markup: this.channelKeyboard(byBind.id),
        };
      }
    }

    const caption = String(body.caption ?? '');
    if (!caption.trim()) return { matched: false as const };

    const candidates = await this.animeRepo
      .createQueryBuilder('a')
      .where('a.channelCaptionHtml IS NOT NULL')
      .andWhere("a.channelCaptionHtml <> ''")
      .getMany();

    const cap = caption.toLowerCase();
    let best: Anime | null = null;
    let bestLen = 0;
    for (const a of candidates) {
      for (const needle of [a.title, a.titleRomaji, a.slug]) {
        const n = String(needle ?? '').trim();
        if (n.length < 4) continue;
        if (cap.includes(n.toLowerCase()) && n.length > bestLen) {
          best = a;
          bestLen = n.length;
        }
      }
    }

    if (!best) return { matched: false as const };
    return {
      matched: true as const,
      anime_id: best.id,
      slug: best.slug,
      reply_markup: this.channelKeyboard(best.id),
    };
  }

  async bindTemplate(dto: BindChannelTemplateDto) {
    const anime = await this.resolveAnime(dto.animeIdOrSlug);
    const coverFileId = String(dto.coverFileId ?? '').trim();
    if (!coverFileId) throw new BadRequestException('coverFileId required');

    const channelId = String(dto.channelId ?? '').trim();
    if (!channelId) throw new BadRequestException('channelId required');

    let captionHtml = String(dto.captionHtml ?? '').trim();
    if (!captionHtml) {
      captionHtml = captionEntitiesToHtml(
        String(dto.captionText ?? ''),
        dto.captionEntities ?? [],
      );
    }
    captionHtml = upgradeKnownEmojisToPremiumHtml(captionHtml);
    captionHtml = upgradeSeasonEpisodePackEmoji(captionHtml);
    captionHtml = repairHtmlCaption(captionHtml);
    if (!captionHtml) {
      throw new BadRequestException('caption required');
    }

    anime.channelCoverFileId = coverFileId;
    anime.channelCaptionHtml = captionHtml;
    anime.channelId = channelId;
    if (dto.channelMessageId != null && String(dto.channelMessageId).trim()) {
      anime.channelLatestMessageId = String(dto.channelMessageId);
    }
    anime.updatedAt = new Date();
    try {
      await this.animeRepo.save(anime);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      this.logger.error(`bindTemplate save failed: ${msg}`);
      if (/channel_cover_file_id|channel_caption_html|channel_id|does not exist/i.test(msg)) {
        throw new BadRequestException(
          'ستون‌های قالب کانال روی جدول anime نیست — production_schema_catchup.sql را اجرا کن',
        );
      }
      throw err;
    }

    return {
      ok: true,
      anime_id: anime.id,
      slug: anime.slug,
      title: anime.title,
      channel_id: anime.channelId,
      channel_latest_message_id: anime.channelLatestMessageId,
    };
  }

  async getDraft(id: string) {
    const draft = await this.draftRepo.findOne({
      where: { id },
      relations: { anime: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    return this.toDraftDto(draft, draft.anime);
  }

  /** Drafts waiting for tel-bot to DM the admin preview. */
  async listPendingPreviews(limitRaw?: number) {
    const limit = Math.min(20, Math.max(1, Number(limitRaw) || 10));
    const drafts = await this.draftRepo.find({
      where: {
        status: 'pending',
        adminPreviewMessageId: IsNull(),
      },
      relations: { anime: true },
      order: { createdAt: 'ASC' },
      take: limit,
    });

    // Auto-reject undeliverable rows so they cannot clog the queue forever.
    const undeliverable = drafts.filter(
      (d) => !d.coverFileId || !String(d.proposedCaption ?? '').trim(),
    );
    if (undeliverable.length) {
      await this.draftRepo
        .createQueryBuilder()
        .update(ChannelPostDraft)
        .set({ status: 'rejected' })
        .whereInIds(undeliverable.map((d) => d.id))
        .execute();
      this.logger.warn(
        `auto-rejected ${undeliverable.length} undeliverable channel draft(s)`,
      );
    }

    const deliverable = drafts.filter(
      (d) => d.coverFileId && String(d.proposedCaption ?? '').trim(),
    );

    return {
      items: deliverable.map((d) => ({
        ...this.toDraftDto(d, d.anime),
        admin_user_id: this.adminUserId(),
        admin_user_ids: this.adminUserIds(),
        draft_keyboard: this.draftKeyboard(d.id, d.animeId),
      })),
    };
  }

  async ackPreview(
    id: string,
    body: {
      chat_id?: string | number;
      chatId?: string | number;
      message_id?: string | number;
      messageId?: string | number;
    },
  ) {
    const draft = await this.draftRepo.findOne({
      where: { id },
      relations: { anime: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');

    const chatId = String(body.chat_id ?? body.chatId ?? '').trim();
    const messageId = String(body.message_id ?? body.messageId ?? '').trim();
    if (!chatId || !messageId) {
      throw new BadRequestException('chat_id and message_id required');
    }

    draft.adminPreviewChatId = chatId;
    draft.adminPreviewMessageId = messageId;
    await this.draftRepo.save(draft);
    return this.toDraftDto(draft, draft.anime);
  }

  /**
   * Mark draft published after tel-bot already sent the channel post.
   */
  async markPublished(
    id: string,
    body: {
      published_message_id?: string | number;
      publishedMessageId?: string | number;
      channel_id?: string;
      channelId?: string;
    },
  ) {
    const draft = await this.draftRepo.findOne({
      where: { id },
      relations: { anime: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status === 'published') {
      return this.toDraftDto(draft, draft.anime);
    }
    if (draft.status !== 'pending') {
      throw new BadRequestException(`Draft status is ${draft.status}`);
    }

    const anime = draft.anime;
    if (!anime) throw new NotFoundException('Anime not found for draft');

    const messageId = String(
      body.published_message_id ?? body.publishedMessageId ?? '',
    ).trim();
    if (!messageId) {
      throw new BadRequestException('published_message_id required');
    }

    const cover = draft.coverFileId || anime.channelCoverFileId;

    draft.status = 'published';
    draft.publishedMessageId = messageId;
    await this.draftRepo.save(draft);

    anime.channelCaptionHtml = draft.proposedCaption;
    if (cover) anime.channelCoverFileId = cover;
    // Keep bind template chat/message as the copy source. Overwriting them with
    // a bot sendPhoto post (or a different publish channel) drops premium emoji
    // on the next publish.
    anime.updatedAt = new Date();
    await this.animeRepo.save(anime);

    return this.toDraftDto(draft, anime);
  }

  /**
   * Build draft from a newly inserted episode.
   * Preview DM is delivered by tel-bot (polls pending-preview) because the API
   * host often cannot reach api.telegram.org.
   */
  async createFromEpisode(animeId: string, episodeNumber: number) {
    const anime = await this.animeRepo.findOne({ where: { id: animeId } });
    if (!anime) throw new NotFoundException('Anime not found');

    if (!anime.channelCoverFileId || !anime.channelCaptionHtml) {
      this.logger.log(
        `channel draft skipped (no template) anime=${animeId} ep=${episodeNumber}`,
      );
      return {
        skipped: true as const,
        reason: 'no_channel_template',
        anime_id: animeId,
        episode_number: episodeNumber,
      };
    }

    const episode = await this.episodeRepo.findOne({
      where: { animeId, episodeNumber },
    });
    if (!episode) throw new NotFoundException('Episode not found');

    const videoUrl = String(episode.downloadLink ?? '').trim();
    if (!videoUrl) {
      return {
        skipped: true as const,
        reason: 'no_download_link',
        anime_id: animeId,
        episode_number: episodeNumber,
      };
    }

    // Rebuild all episode lines from catalog (≤ focus) so earlier eps are not dropped
    // when the bound template is stale, and mark prior eps with green check.
    const catalogEps = await this.episodeRepo.find({
      where: { animeId },
      order: { episodeNumber: 'ASC' },
    });
    const subtitles = await this.subtitleRepo.find({ where: { animeId } });
    const subByEp = new Map<number, string>();
    for (const sub of subtitles) {
      const n = Number(sub.episodeNumber);
      const link = String(sub.subtitleLink ?? '').trim();
      if (Number.isFinite(n) && link) subByEp.set(n, link);
    }

    const focus = Number(episodeNumber);
    const episodeLines: string[] = [];
    for (const ep of catalogEps) {
      const n = Number(ep.episodeNumber);
      if (!Number.isFinite(n) || n > focus) continue;
      const link = String(ep.downloadLink ?? '').trim();
      if (!link) continue;
      episodeLines.push(
        buildEpisodeCaptionLine({
          episodeNumber: n,
          videoUrl: link,
          subtitleUrl: subByEp.get(n) ?? null,
          videoFileType: ep.videoFileType,
          isNew: n === focus,
        }),
      );
    }

    if (!episodeLines.length) {
      episodeLines.push(
        buildEpisodeCaptionLine({
          episodeNumber,
          videoUrl,
          subtitleUrl: subByEp.get(focus) ?? null,
          videoFileType: episode.videoFileType,
          isNew: true,
        }),
      );
    }

    const templateHtml = upgradeSeasonEpisodePackEmoji(
      upgradeKnownEmojisToPremiumHtml(anime.channelCaptionHtml),
    );
    if (templateHtml !== anime.channelCaptionHtml) {
      anime.channelCaptionHtml = templateHtml;
      anime.updatedAt = new Date();
      await this.animeRepo.save(anime);
    }

    const proposedCaption = repairHtmlCaption(
      upgradeSeasonEpisodePackEmoji(
        replaceEpisodeLinesInCaption(templateHtml, episodeLines),
      ),
    );

    // Drop older undelivered previews for this anime so the bot queue cannot pile up.
    await this.draftRepo
      .createQueryBuilder()
      .update(ChannelPostDraft)
      .set({ status: 'rejected' })
      .where('anime_id = :animeId', { animeId })
      .andWhere('status = :status', { status: 'pending' })
      .andWhere('admin_preview_message_id IS NULL')
      .execute();

    const adminId = this.adminUserId();
    const draft = await this.draftRepo.save(
      this.draftRepo.create({
        animeId,
        episodeNumber,
        proposedCaption,
        coverFileId: anime.channelCoverFileId,
        status: 'pending',
        adminPreviewChatId: adminId != null ? String(adminId) : null,
      }),
    );

    this.logger.log(
      `channel draft queued for bot preview draft=${draft.id} anime=${animeId} ep=${episodeNumber}`,
    );

    return {
      skipped: false as const,
      draft: this.toDraftDto(draft, anime),
      preview_sent: false,
      preview_queued: true,
      reason: adminId ? 'queued_for_bot' : 'admin_not_configured',
    };
  }

  async rejectDraft(id: string) {
    const draft = await this.draftRepo.findOne({ where: { id } });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status !== 'pending') {
      return this.toDraftDto(draft);
    }

    draft.status = 'rejected';
    await this.draftRepo.save(draft);
    // Keyboard clear is done by tel-bot (API often cannot reach Telegram).
    return this.toDraftDto(draft);
  }

  /** Reject pending drafts that still await admin preview DM (clear bot queue). */
  async clearPendingPreviews() {
    const result = await this.draftRepo
      .createQueryBuilder()
      .update(ChannelPostDraft)
      .set({ status: 'rejected' })
      .where('status = :status', { status: 'pending' })
      .andWhere('admin_preview_message_id IS NULL')
      .execute();

    const cleared = Number(result.affected ?? 0);
    this.logger.log(`cleared ${cleared} pending channel draft preview(s)`);
    return { ok: true as const, cleared };
  }

  /**
   * Prepare publish payload for tel-bot. Does not call Telegram from API.
   */
  async publishDraft(
    id: string,
    body?: { channel_id?: string; channelId?: string },
  ) {
    const draft = await this.draftRepo.findOne({
      where: { id },
      relations: { anime: true },
    });
    if (!draft) throw new NotFoundException('Draft not found');
    if (draft.status === 'published') {
      return {
        needs_bot_send: false as const,
        already_published: true as const,
        draft: this.toDraftDto(draft, draft.anime),
      };
    }
    if (draft.status !== 'pending') {
      throw new BadRequestException(`Draft status is ${draft.status}`);
    }

    const anime = draft.anime;
    if (!anime) throw new NotFoundException('Anime not found for draft');

    const requested = String(body?.channel_id ?? body?.channelId ?? '').trim();
    const channelId = requested || this.postsChannelId(anime);
    if (!channelId) {
      throw new BadRequestException(
        'channel_id required (or set PUBLIC_POSTS_CHANNEL_ID / anime.channel_id)',
      );
    }

    const cover = draft.coverFileId || anime.channelCoverFileId;
    if (!cover) throw new BadRequestException('cover file id missing');

    const sourceChatId = String(anime.channelId ?? '').trim();
    const sourceMessageId = String(anime.channelLatestMessageId ?? '').trim();

    return {
      needs_bot_send: true as const,
      draft: this.toDraftDto(draft, anime),
      channel_id: channelId,
      cover_file_id: cover,
      caption: repairHtmlCaption(draft.proposedCaption),
      reply_markup: this.shouldAttachMiniAppButton(channelId)
        ? this.channelKeyboard(anime.id)
        : undefined,
      anime_id: anime.id,
      source_chat_id: sourceChatId || null,
      source_message_id: sourceMessageId || null,
    };
  }
}
