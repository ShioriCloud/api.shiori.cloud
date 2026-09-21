import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import {
  NotificationCampaign,
  TelegramDmOutbox,
  UserNotification,
} from '../../entities';
import { TelegramDmOutboxService } from './telegram-dm-outbox.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      TelegramDmOutbox,
      NotificationCampaign,
      UserNotification,
    ]),
  ],
  providers: [TelegramDmOutboxService],
  exports: [TelegramDmOutboxService],
})
export class TelegramDmModule {}
