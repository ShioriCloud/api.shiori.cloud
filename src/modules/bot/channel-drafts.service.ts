import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Anime,
  AnimeEpisode,
  AnimeSubtitle,
  ChannelPostDraft,
} from '../../entities';
import { TelegramBotService } from '../../telegram/telegram-bot.service';
import {
  appendEpisodeLineToCaption,
  buildEpisodeCaptionLine,
  buildMiniAppEpisodesUrl,
  captionEntitiesToHtml,
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
    private readonly telegram: TelegramBotService,
    private readonly config: ConfigService,
  ) {}

  private async resolveAnime(idOrSlug: string): Promise<Anime> {
    const key = String(idOrSlug ?? '').trim();
    if (!key) throw new BadRequestException('anime id/slug required');

    const byId = await this.animeRepo.findOne({ where: { id: key } });
    if (byId) return byId;

    const bySlug = await this.animeRepo.findOne({ where: { slug: key } });
    if (bySlug) return bySlug;

    throw new NotFoundException('Anime not found');
  }

  private adminUserId(): number | null {
    const raw = this.config.get<string>('telegram.adminUserId')?.trim();
    const n = Number(raw);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  private postsChannelId(anime?: Anime | null): string {
    const fromAnime = String(anime?.channelId ?? '').trim();
    if (fromAnime) return fromAnime;
    return String(this.config.get<string>('telegram.postsChannelId') ?? '').trim();
  }

  private botUsername(): string {
    return (
      this.config.get<string>('telegram.botUsername')?.trim() || 'ShioriUploadBot'
    );
  }

  private draftKeyboard(draftId: string, animeId: string) {
    const miniUrl = buildMiniAppEpisodesUrl(this.botUsername(), animeId);
    return {
      inline_keyboard: [
        [
          { text: '✅ انتشار در کانال', callback_data: `chdraft_ok_${draftId}` },
          { text: '❌ رد', callback_data: `chdraft_no_${draftId}` },
        ],
        [
          {
            text: 'دانلود از مینی‌اپ',
            url: miniUrl,
            style: 'primary',
          },
        ],
      ],
    };
  }

  private channelKeyboard(animeId: string) {
    return {
      inline_keyboard: [
        [
          {
            text: 'دانلود از مینی‌اپ',
            url: buildMiniAppEpisodesUrl(this.botUsername(), animeId),
            style: 'primary',
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
    await this.animeRepo.save(anime);

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

  /**
   * Build draft from a newly inserted episode and DM preview to admin.
   * Returns null when anime has no channel template (non-fatal).
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

    const subtitle = await this.subtitleRepo.findOne({
      where: { animeId, episodeNumber },
    });
    const subtitleUrl = String(subtitle?.subtitleLink ?? '').trim() || null;

    const episodeLine = buildEpisodeCaptionLine({
      episodeNumber,
      videoUrl,
      subtitleUrl,
      videoFileType: episode.videoFileType,
      isNew: true,
    });

    const proposedCaption = appendEpisodeLineToCaption(
      anime.channelCaptionHtml,
      episodeLine,
      episodeNumber,
    );

    const draft = await this.draftRepo.save(
      this.draftRepo.create({
        animeId,
        episodeNumber,
        proposedCaption,
        coverFileId: anime.channelCoverFileId,
        status: 'pending',
      }),
    );

    const adminId = this.adminUserId();
    if (!adminId) {
      this.logger.warn('ADMIN_USER_ID not set — draft saved without DM preview');
      return {
        skipped: false as const,
        draft: this.toDraftDto(draft, anime),
        preview_sent: false,
        reason: 'admin_not_configured',
      };
    }

    const previewNotice = await this.telegram.sendMessage({
      chatId: adminId,
      text:
        `پیش‌نویس پست کانال\n` +
        `<b>${anime.title}</b> — قسمت ${episodeNumber}\n` +
        `تأیید → انتشار در کانال`,
      parseMode: 'HTML',
    });

    const preview = await this.telegram.sendPhoto({
      chatId: adminId,
      photo: draft.coverFileId!,
      caption: proposedCaption,
      parseMode: 'HTML',
      replyMarkup: this.draftKeyboard(draft.id, anime.id),
      disableWebPagePreview: true,
    });

    if (!preview.ok || !preview.result?.message_id) {
      this.logger.warn(
        `Failed to send channel draft preview: ${preview.description}`,
      );
      return {
        skipped: false as const,
        draft: this.toDraftDto(draft, anime),
        preview_sent: false,
        reason: preview.description ?? 'sendPhoto_failed',
        notice_sent: Boolean(previewNotice.ok),
      };
    }

    draft.adminPreviewChatId = String(adminId);
    draft.adminPreviewMessageId = String(preview.result.message_id);
    await this.draftRepo.save(draft);

    return {
      skipped: false as const,
      draft: this.toDraftDto(draft, anime),
      preview_sent: true,
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

    if (draft.adminPreviewChatId && draft.adminPreviewMessageId) {
      await this.telegram.editMessageReplyMarkup({
        chatId: draft.adminPreviewChatId,
        messageId: Number(draft.adminPreviewMessageId),
        replyMarkup: { inline_keyboard: [] },
      });
    }

    return this.toDraftDto(draft);
  }

  async publishDraft(id: string) {
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

    const channelId = this.postsChannelId(anime);
    if (!channelId) {
      throw new BadRequestException('PUBLIC_POSTS_CHANNEL_ID / anime.channel_id not set');
    }

    const cover = draft.coverFileId || anime.channelCoverFileId;
    if (!cover) throw new BadRequestException('cover file id missing');

    const sent = await this.telegram.sendPhoto({
      chatId: channelId,
      photo: cover,
      caption: draft.proposedCaption,
      parseMode: 'HTML',
      replyMarkup: this.channelKeyboard(anime.id),
      disableWebPagePreview: true,
    });

    if (!sent.ok || !sent.result?.message_id) {
      throw new BadRequestException(
        sent.description ?? 'Failed to publish channel post',
      );
    }

    draft.status = 'published';
    draft.publishedMessageId = String(sent.result.message_id);
    await this.draftRepo.save(draft);

    anime.channelCaptionHtml = draft.proposedCaption;
    anime.channelCoverFileId = cover;
    anime.channelLatestMessageId = String(sent.result.message_id);
    anime.channelId = channelId;
    anime.updatedAt = new Date();
    await this.animeRepo.save(anime);

    if (draft.adminPreviewChatId && draft.adminPreviewMessageId) {
      await this.telegram.editMessageReplyMarkup({
        chatId: draft.adminPreviewChatId,
        messageId: Number(draft.adminPreviewMessageId),
        replyMarkup: { inline_keyboard: [] },
      });
      await this.telegram.sendMessage({
        chatId: draft.adminPreviewChatId,
        text:
          `✅ پست در کانال منتشر شد.\n` +
          `message_id: ${sent.result.message_id}`,
        parseMode: 'HTML',
      });
    }

    return this.toDraftDto(draft, anime);
  }
}
