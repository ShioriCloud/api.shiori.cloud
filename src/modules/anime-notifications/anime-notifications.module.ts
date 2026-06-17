import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserNotification } from '../../entities';
import { AnimeNotificationsController } from './anime-notifications.controller';
import { AnimeNotificationsService } from './anime-notifications.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserNotification, TelegramUser])],
  controllers: [AnimeNotificationsController],
  providers: [AnimeNotificationsService],
})
export class AnimeNotificationsModule {}
