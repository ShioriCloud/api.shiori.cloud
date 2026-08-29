import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  buildMiniAppWelcomeReplyMarkup,
  buildMiniAppWelcomeText,
} from './mini-app-bot-welcome';
import { TelegramBotService } from './telegram-bot.service';

type TelegramUpdate = {
  update_id: number;
  message?: {
    message_id: number;
    text?: string;
    chat?: { id: number; type?: string };
  };
};

@Injectable()
export class MiniAppBotUpdatesService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MiniAppBotUpdatesService.name);
  private running = false;
  private offset = 0;

  constructor(
    private readonly config: ConfigService,
    private readonly telegram: TelegramBotService,
  ) {}

  onModuleInit(): void {
    const token = this.telegram.getMiniAppBotToken();
    if (!token) {
      this.logger.log(
        'No Mini App bot token — /start welcome disabled (set TELEGRAM_MINI_APP_BOT_TOKEN or TELEGRAM_BOT_TOKEN)',
      );
      return;
    }

    const enabled =
      this.config.get<boolean>('telegram.miniAppBotUpdatesEnabled') !== false;
    if (!enabled) {
      this.logger.log('Mini App bot updates polling disabled by config');
      return;
    }

    this.running = true;
    void this.bootstrapPolling();
  }

  onModuleDestroy(): void {
    this.running = false;
  }

  private async bootstrapPolling(): Promise<void> {
    try {
      await this.telegram.ensureMiniAppBotPollingMode();
      this.logger.log('Mini App bot (@ShioriMiniBot) /start handler started');
      await this.pollLoop();
    } catch (error) {
      this.logger.error(
        `Mini App bot polling failed: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
    }
  }

  private async pollLoop(): Promise<void> {
    while (this.running) {
      try {
        const json = await this.telegram.callMiniAppBotApi<TelegramUpdate[]>(
          'getUpdates',
          {
            offset: this.offset,
            timeout: 50,
            allowed_updates: ['message'],
          },
        );

        if (!json.ok) {
          this.logger.warn(
            `Mini App bot getUpdates failed: ${json.description ?? 'unknown'}`,
          );
          await this.sleep(3000);
          continue;
        }

        for (const update of json.result ?? []) {
          this.offset = Math.max(this.offset, update.update_id + 1);
          await this.handleUpdate(update);
        }
      } catch (error) {
        this.logger.warn(
          `Mini App bot poll error: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        await this.sleep(3000);
      }
    }
  }

  private async handleUpdate(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    const chatId = message?.chat?.id;
    const chatType = message?.chat?.type;
    const text = String(message?.text ?? '').trim();

    if (!chatId || chatType !== 'private' || !text) return;

    if (text.startsWith('/start') || text.startsWith('/help')) {
      await this.sendWelcome(chatId);
      return;
    }

    if (!text.startsWith('/')) {
      await this.telegram.sendMiniAppBotMessage({
        chatId,
        text: 'ℹ️ برای باز کردن مینی‌اپ از دکمهٔ زیر استفاده کنید.',
        parseMode: 'HTML',
        replyMarkup: this.welcomeMarkup(),
      });
    }
  }

  private welcomeMarkup() {
    return buildMiniAppWelcomeReplyMarkup(
      this.config.get<string>('miniApp.baseUrl') ?? '',
      this.config.get<string>('telegram.miniAppBotUsername') ?? 'ShioriMiniBot',
    ).reply_markup;
  }

  private async sendWelcome(chatId: number): Promise<void> {
    const replyMarkup = this.welcomeMarkup();
    const result = await this.telegram.sendMiniAppBotMessage({
      chatId,
      text: buildMiniAppWelcomeText(),
      parseMode: 'HTML',
      replyMarkup,
    });

    if (result.ok) return;

    const desc = result.description ?? 'sendMessage failed';
    this.logger.warn(`Welcome send failed for chat ${chatId}: ${desc}`);

    if (/BUTTON|web_app|URL_INVALID/i.test(desc)) {
      const retry = await this.telegram.sendMiniAppBotMessage({
        chatId,
        text: buildMiniAppWelcomeText(),
        parseMode: 'HTML',
      });
      if (!retry.ok) {
        this.logger.warn(
          `Welcome retry without button failed for chat ${chatId}: ${retry.description ?? 'unknown'}`,
        );
      }
    }
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
