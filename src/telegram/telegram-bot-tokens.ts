import { ConfigService } from '@nestjs/config';

export const getTelegramBotTokens = (config: ConfigService): string[] => {
  const primary = String(config.get<string>('telegram.botToken') ?? '').trim();
  const extra = (config.get<string[]>('telegram.botTokens') ?? [])
    .map((token) => String(token).trim())
    .filter(Boolean);

  return [...new Set([primary, ...extra].filter(Boolean))];
};
