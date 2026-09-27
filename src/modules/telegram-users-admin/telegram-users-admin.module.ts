import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  DownloadTokenLedger,
  SponsorJoinEvent,
  SupportTicket,
  SupportTicketMessage,
  TelegramUser,
  UserAnimeAiringReminder,
  UserAnimeListEntry,
  UserCustomList,
  UserCustomListItem,
  UserNotification,
  UserPortalSession,
  AdminAuditEvent,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { TelegramUsersAdminController } from './telegram-users-admin.controller';
import { TelegramUsersAdminService } from './telegram-users-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    TypeOrmModule.forFeature([
      TelegramUser,
      UserAnimeListEntry,
      UserCustomList,
      UserCustomListItem,
      UserAnimeAiringReminder,
      DownloadTokenLedger,
      SupportTicket,
      SupportTicketMessage,
      UserNotification,
      SponsorJoinEvent,
      UserPortalSession,
      AdminAuditEvent,
    ]),
  ],
  controllers: [TelegramUsersAdminController],
  providers: [TelegramUsersAdminService],
})
export class TelegramUsersAdminModule {}
