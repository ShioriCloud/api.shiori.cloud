import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserPortalSession, TelegramLinkToken } from '../../entities';
import { AppAuthController } from './app-auth.controller';
import { AppAuthService } from './app-auth.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUser, UserPortalSession, TelegramLinkToken]),
  ],
  controllers: [AppAuthController],
  providers: [AppAuthService],
  exports: [AppAuthService],
})
export class AppAuthModule {}
