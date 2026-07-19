import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AnimeEpisode,
  DownloadTokenLedger,
  TelegramUser,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { DownloadTokensController } from './download-tokens.controller';
import { DownloadTokensService } from './download-tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUser, AnimeEpisode, DownloadTokenLedger]),
    TelegramModule,
    PortalAuthModule,
  ],
  controllers: [DownloadTokensController],
  providers: [DownloadTokensService],
  exports: [DownloadTokensService],
})
export class DownloadTokensModule {}
