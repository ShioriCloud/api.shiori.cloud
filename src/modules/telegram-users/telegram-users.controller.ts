import {
  Body,
  Controller,
  Headers,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { verifyTelegramInitData } from '../../telegram/telegram-init-data';
import { getTelegramBotTokens } from '../../telegram/telegram-bot-tokens';
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
    @Headers('x-telegram-init-data') initDataHeader: string,
    @Body() body: RegisterTelegramUserDto,
  ) {
    const initData = String(
      initDataHeader ?? body.telegram_init_data ?? '',
    ).trim();
    const botTokens = getTelegramBotTokens(this.config);
    const verified = verifyTelegramInitData(initData, botTokens);

    if (verified.userId == null) {
      throw new UnauthorizedException(
        `invalid telegram init data (${verified.reason})`,
      );
    }

    if (verified.userId !== body.telegram_user_id) {
      throw new UnauthorizedException('telegram_user_id mismatch');
    }

    const session = await this.telegramUsersService.registerVisit(body);
    return { ok: true, ...session };
  }
}
