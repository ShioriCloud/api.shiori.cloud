import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TelegramSendError = { chat_id: number; message: string };

export type TelegramApiResult<T = unknown> = {
  ok: boolean;
  result?: T;
  description?: string;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class TelegramBotService {
  private readonly logger = new Logger(TelegramBotService.name);

  constructor(private readonly config: ConfigService) {}

  private getToken(): string {
    return this.config.get<string>('telegram.botToken')?.trim() ?? '';
  }

  private getMiniAppBotToken(): string {
    const dedicated =
      this.config.get<string>('telegram.miniAppBotToken')?.trim() ?? '';
    if (dedicated) return dedicated;
    return this.getToken();
  }

  /** Prefer Mini App host bot so DMs go to the bot users actually open. */
  private getNotificationTokens(): string[] {
    const mini = this.getMiniAppBotToken();
    const extras = (this.config.get<string[]>('telegram.botTokens') ?? []).map(
      (token) => String(token).trim(),
    );
    const primary = this.getToken();
    return [...new Set([mini, ...extras, primary].filter(Boolean))];
  }

  private async callApi<T = unknown>(
    method: string,
    body: Record<string, unknown>,
    token = this.getToken(),
  ): Promise<TelegramApiResult<T>> {
    if (!token) {
      return { ok: false, description: 'TELEGRAM_BOT_TOKEN not configured' };
    }

    try {
      const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      return (await res.json()) as TelegramApiResult<T>;
    } catch (e) {
      return {
        ok: false,
        description: e instanceof Error ? e.message : 'telegram api error',
      };
    }
  }

  async sendEpisodeNotifications(payload: {
    chatIds: number[];
    text: string;
    webAppUrl?: string | null;
  }): Promise<{ sent: number; sentChatIds: number[]; errors: TelegramSendError[] }> {
    const tokens = this.getNotificationTokens();
    if (tokens.length === 0) {
      this.logger.warn('Skipping Telegram DMs — no bot token configured');
      return {
        sent: 0,
        sentChatIds: [],
        errors: payload.chatIds.map((chat_id) => ({
          chat_id,
          message: 'TELEGRAM_BOT_TOKEN not configured',
        })),
      };
    }

    const replyMarkup =
      payload.webAppUrl != null
        ? {
            inline_keyboard: [
              [{ text: 'مشاهده در شیوری', web_app: { url: payload.webAppUrl } }],
            ],
          }
        : undefined;

    let sent = 0;
    const sentChatIds: number[] = [];
    const errors: TelegramSendError[] = [];
    let preferredToken = tokens[0];

    for (const chatId of payload.chatIds) {
      if (!Number.isFinite(chatId)) continue;

      const orderedTokens = [
        preferredToken,
        ...tokens.filter((token) => token !== preferredToken),
      ];
      let lastError = 'sendMessage failed';
      let success = false;

      for (const token of orderedTokens) {
        const json = await this.callApi<{ message_id?: number }>(
          'sendMessage',
          {
            chat_id: chatId,
            text: payload.text,
            disable_web_page_preview: true,
            ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
          },
          token,
        );

        if (json.ok) {
          success = true;
          preferredToken = token;
          break;
        }

        lastError = json.description ?? lastError;
        const desc = lastError;

        if (/BUTTON|web_app|URL_INVALID/i.test(desc) && replyMarkup) {
          const retry = await this.callApi<{ message_id?: number }>(
            'sendMessage',
            {
              chat_id: chatId,
              text: payload.text,
              disable_web_page_preview: true,
            },
            token,
          );
          if (retry.ok) {
            success = true;
            preferredToken = token;
            this.logger.warn(
              `Telegram DM sent without web_app button (chat ${chatId}): ${desc}`,
            );
            break;
          }
          lastError = retry.description ?? lastError;
        }

        if (/429|retry after/i.test(lastError)) {
          await sleep(1000);
        }
      }

      if (success) {
        sent += 1;
        sentChatIds.push(chatId);
      } else {
        this.logger.warn(`Telegram DM failed for chat ${chatId}: ${lastError}`);
        errors.push({ chat_id: chatId, message: lastError });
      }

      await sleep(55);
    }

    return { sent, sentChatIds, errors };
  }

  async sendPhoto(payload: {
    chatId: number | string;
    photo: string;
    caption?: string;
    parseMode?: 'HTML' | 'Markdown';
    replyMarkup?: Record<string, unknown>;
    disableWebPagePreview?: boolean;
  }): Promise<TelegramApiResult<{ message_id: number }>> {
    return this.callApi<{ message_id: number }>('sendPhoto', {
      chat_id: payload.chatId,
      photo: payload.photo,
      ...(payload.caption != null ? { caption: payload.caption } : {}),
      ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
      ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
      ...(payload.disableWebPagePreview
        ? { disable_web_page_preview: true }
        : {}),
    });
  }

  async sendMessage(payload: {
    chatId: number | string;
    text: string;
    parseMode?: 'HTML' | 'Markdown';
    replyMarkup?: Record<string, unknown>;
    disableWebPagePreview?: boolean;
  }): Promise<TelegramApiResult<{ message_id: number }>> {
    return this.callApi<{ message_id: number }>('sendMessage', {
      chat_id: payload.chatId,
      text: payload.text,
      ...(payload.parseMode ? { parse_mode: payload.parseMode } : {}),
      ...(payload.replyMarkup ? { reply_markup: payload.replyMarkup } : {}),
      ...(payload.disableWebPagePreview !== false
        ? { disable_web_page_preview: true }
        : {}),
    });
  }

  async editMessageReplyMarkup(payload: {
    chatId: number | string;
    messageId: number;
    replyMarkup?: Record<string, unknown> | null;
  }): Promise<TelegramApiResult> {
    return this.callApi('editMessageReplyMarkup', {
      chat_id: payload.chatId,
      message_id: payload.messageId,
      reply_markup: payload.replyMarkup ?? { inline_keyboard: [] },
    });
  }
}
