import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  Anime,
  AnimeEpisode,
  NotificationCampaign,
  TelegramUser,
  UserAnimeAiringReminder,
  UserNotification,
} from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { NotificationsAdminController } from './notifications-admin.controller';
import { NotificationsAdminService } from './notifications-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    TypeOrmModule.forFeature([
      NotificationCampaign,
      Anime,
      AnimeEpisode,
      UserAnimeAiringReminder,
      UserNotification,
      TelegramUser,
    ]),
  ],
  controllers: [NotificationsAdminController],
  providers: [NotificationsAdminService],
  exports: [NotificationsAdminService],
})
export class NotificationsAdminModule {}
