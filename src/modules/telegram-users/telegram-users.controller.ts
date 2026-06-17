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
    const initData = String(initDataHeader ?? '').trim();
    const botToken = this.config.get<string>('telegram.botToken') ?? '';
    const verified = verifyTelegramInitData(initData, botToken);

    if (verified.userId == null) {
      throw new UnauthorizedException(
        `invalid telegram init data (${verified.reason})`,
      );
    }

    if (verified.userId !== body.telegram_user_id) {
      throw new UnauthorizedException('telegram_user_id mismatch');
    }

    await this.telegramUsersService.registerVisit(body);
    return { ok: true };
  }
}
