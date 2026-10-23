import {
  Body,
  Controller,
  ForbiddenException,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { verifyTelegramInitData } from '../../telegram/telegram-init-data';
import { getTelegramBotTokens } from '../../telegram/telegram-bot-tokens';
import { readSessionTokenFromRequest } from '../../telegram/read-session-token';
import { RegisterTelegramUserDto } from './telegram-users.dto';
import { TelegramUsersService } from './telegram-users.service';

@ApiTags('Telegram Users')
@Controller('telegram-users')
export class TelegramUsersController {
  constructor(
    private readonly telegramUsersService: TelegramUsersService,
    private readonly config: ConfigService,
  ) {}

  @Post('register')
  @ApiOperation({ summary: 'Register or update Telegram user visit' })
  async register(
    @Headers() headers: Record<string, string | string[] | undefined>,
    @Body() body: RegisterTelegramUserDto,
  ) {
    const initDataHeader = headers['x-telegram-init-data'];
    const initData = String(
      (Array.isArray(initDataHeader) ? initDataHeader[0] : initDataHeader) ??
        body.telegram_init_data ??
        '',
    ).trim();
    const sessionToken = readSessionTokenFromRequest(headers, body);
    const botTokens = getTelegramBotTokens(this.config);
    const verified = verifyTelegramInitData(initData, botTokens);

    if (verified.userId == null) {
      const touched = await this.telegramUsersService.touchVisitFromSession(
        body.telegram_user_id,
        sessionToken,
      );
      if (touched) return { ok: true, ...touched };
      throw new UnauthorizedException(
        `invalid telegram init data (${verified.reason})`,
      );
    }

    if (verified.userId !== body.telegram_user_id) {
      throw new UnauthorizedException('telegram_user_id mismatch');
    }

    const session = await this.telegramUsersService.registerVisit(
      body,
      sessionToken,
    );
    return { ok: true, ...session };
  }

  @Post('dev-session')
  @ApiOperation({
    summary: 'DEV ONLY: issue session without Telegram (ALLOW_DEV_AUTH=true)',
  })
  async devSession(@Body() body?: { telegram_user_id?: number | string }) {
    if (!this.config.get<boolean>('allowDevAuth')) {
      throw new ForbiddenException('dev auth disabled');
    }

    const configured = String(
      this.config.get<string>('devTelegramUserId') ?? '90344148',
    ).trim();
    const fromBody = String(body?.telegram_user_id ?? '').trim();
    const telegramUserId = fromBody || configured;
    if (!/^\d+$/.test(telegramUserId)) {
      throw new UnauthorizedException('invalid telegram_user_id');
    }

    const session = await this.telegramUsersService.registerVisit({
      telegram_user_id: Number(telegramUserId),
      first_name: 'Dev',
      last_name: null,
      username: null,
      language_code: 'fa',
      photo_url: null,
      is_premium: false,
    });

    return { ok: true, telegram_user_id: Number(telegramUserId), ...session };
  }
}
