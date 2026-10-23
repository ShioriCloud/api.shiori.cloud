import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser, UserPortalSession } from '../../entities';
import { TelegramUsersController } from './telegram-users.controller';
import { TelegramUsersService } from './telegram-users.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser, UserPortalSession])],
  controllers: [TelegramUsersController],
  providers: [TelegramUsersService],
  exports: [TelegramUsersService],
})
export class TelegramUsersModule {}
