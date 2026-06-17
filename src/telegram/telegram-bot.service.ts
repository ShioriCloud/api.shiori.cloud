import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type TelegramSendError = { chat_id: number; message: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

@Injectable()
export class TelegramBotService {
  constructor(private readonly config: ConfigService) {}

  async sendEpisodeNotifications(payload: {
    chatIds: number[];
    text: string;
    webAppUrl?: string | null;
  }): Promise<{ sent: number; errors: TelegramSendError[] }> {
    const token = this.config.get<string>('telegram.botToken')?.trim();
    if (!token) {
      return {
        sent: 0,
        errors: [{ chat_id: 0, message: 'TELEGRAM_BOT_TOKEN not configured' }],
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
    const errors: TelegramSendError[] = [];

    for (const chatId of payload.chatIds) {
      if (!Number.isFinite(chatId)) continue;

      try {
        const res = await fetch(
          `https://api.telegram.org/bot${token}/sendMessage`,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              text: payload.text,
              disable_web_page_preview: true,
              ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
            }),
          },
        );

        const json = (await res.json()) as { ok?: boolean; description?: string };
        if (json.ok) {
          sent += 1;
        } else {
          errors.push({
            chat_id: chatId,
            message: json.description ?? 'sendMessage failed',
          });
        }
      } catch (e) {
        errors.push({
          chat_id: chatId,
          message: e instanceof Error ? e.message : 'sendMessage error',
        });
      }

      await sleep(55);
    }

    return { sent, errors };
  }
}
