import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Anime, AnimeEpisode, TelegramUser } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { TelegramModule } from '../../telegram/telegram.module';
import { SubscriptionsController } from './subscriptions.controller';
import { SubscriptionsService } from './subscriptions.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([TelegramUser, AnimeEpisode, Anime]),
    TelegramModule,
    PortalAuthModule,
  ],
  controllers: [SubscriptionsController],
  providers: [SubscriptionsService],
  exports: [SubscriptionsService],
})
export class SubscriptionsModule {}
