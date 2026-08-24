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

  private async callApi<T = unknown>(
    method: string,
    body: Record<string, unknown>,
  ): Promise<TelegramApiResult<T>> {
    const token = this.getToken();
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

    for (const chatId of payload.chatIds) {
      if (!Number.isFinite(chatId)) continue;

      let success = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        const json = await this.callApi<{ message_id?: number }>('sendMessage', {
          chat_id: chatId,
          text: payload.text,
          disable_web_page_preview: true,
          ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
        });

        if (json.ok) {
          success = true;
          break;
        }

        // Don't retry on permanent errors (user blocked bot, chat not found, etc.)
        const desc = json.description ?? '';
        if (/block|deactivat|not found|rights/i.test(desc)) {
          errors.push({ chat_id: chatId, message: desc });
          break;
        }

        if (attempt < 2) {
          await sleep(500 * (attempt + 1));
        } else {
          errors.push({ chat_id: chatId, message: desc || 'sendMessage failed after retries' });
        }
      }

      if (success) {
        sent += 1;
        sentChatIds.push(chatId);
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
