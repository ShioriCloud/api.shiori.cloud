import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserPortalSession } from '../entities';
import { AppUserAuthGuard } from './app-user-auth.guard';
import { AppUserAuthService } from './app-user-auth.service';
import { TelegramAuthGuard } from './telegram-auth.guard';
import { TelegramBotService } from './telegram-bot.service';

@Global()
@Module({
  imports: [TypeOrmModule.forFeature([UserPortalSession, TelegramUser])],
  providers: [
    AppUserAuthService,
    TelegramAuthGuard,
    AppUserAuthGuard,
    TelegramBotService,
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
