import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { TelegramUser } from '../../entities';
import { TelegramUsersController } from './telegram-users.controller';
import { TelegramUsersService } from './telegram-users.service';

@Module({
  imports: [TypeOrmModule.forFeature([TelegramUser])],
  controllers: [TelegramUsersController],
  providers: [TelegramUsersService],
})
export class TelegramUsersModule {}
