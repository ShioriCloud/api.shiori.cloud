import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  AdminAuditEvent,
  AnimeEpisode,
  DownloadTokenLedger,
  TelegramUser,
  UserEpisodeDownloadReceipt,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { DarametDonatesClient } from './daramet-donates.client';
import { DownloadTokensController } from './download-tokens.controller';
import { DownloadTokensService } from './download-tokens.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramUser,
      AnimeEpisode,
      DownloadTokenLedger,
      UserEpisodeDownloadReceipt,
      AdminAuditEvent,
    ]),
    TelegramModule,
    PortalAuthModule,
  ],
  controllers: [DownloadTokensController],
  providers: [DownloadTokensService, DarametDonatesClient],
  exports: [DownloadTokensService],
})
export class DownloadTokensModule {}
