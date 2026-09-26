import { ConfigService } from '@nestjs/config';

/**
 * Tokens accepted for Telegram WebApp initData HMAC verification.
 * Prefer Mini App host bot first (users open that bot), then extras, then upload bot.
 */
export const getTelegramBotTokens = (config: ConfigService): string[] => {
  const mini = String(
    config.get<string>('telegram.miniAppBotToken') ?? '',
  ).trim();
  const primary = String(config.get<string>('telegram.botToken') ?? '').trim();
  const extra = (config.get<string[]>('telegram.botTokens') ?? [])
    .map((token) => String(token).trim())
    .filter(Boolean);

  return [...new Set([mini, ...extra, primary].filter(Boolean))];
};
