import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserAnimeListEntry } from '../../entities';
import { PortalAuthModule } from '../portal-auth/portal-auth.module';
import { TelegramUsersAdminController } from './telegram-users-admin.controller';
import { TelegramUsersAdminService } from './telegram-users-admin.service';

@Module({
  imports: [
    PortalAuthModule,
    TypeOrmModule.forFeature([TelegramUser, UserAnimeListEntry]),
  ],
  controllers: [TelegramUsersAdminController],
  providers: [TelegramUsersAdminService],
})
export class TelegramUsersAdminModule {}
