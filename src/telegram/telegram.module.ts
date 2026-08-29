import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserPortalSession } from '../entities';
import { AppUserAuthGuard } from './app-user-auth.guard';
import { AppUserAuthService } from './app-user-auth.service';
import { MiniAppBotUpdatesService } from './mini-app-bot-updates.service';
import { TelegramAuthGuard } from './telegram-auth.guard';
import { TelegramBotService } from './telegram-bot.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserPortalSession])],
  providers: [
    AppUserAuthService,
    TelegramAuthGuard,
    AppUserAuthGuard,
    TelegramBotService,
    MiniAppBotUpdatesService,
  ],
  exports: [
    TypeOrmModule,
    AppUserAuthService,
    TelegramAuthGuard,
    AppUserAuthGuard,
    TelegramBotService,
  ],
})
export class TelegramModule {}
