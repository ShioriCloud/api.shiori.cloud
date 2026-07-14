import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BotFile, BotFileDownloadEvent, BotSetting, FilePack, FilePackItem } from '../../entities';
import { BotAuthGuard } from './bot-auth.guard';
import { BotController } from './bot.controller';
import { BotService } from './bot.service';

@Module({
  imports: [TypeOrmModule.forFeature([BotFile, BotFileDownloadEvent, FilePack, FilePackItem, BotSetting])],
  controllers: [BotController],
  providers: [BotService, BotAuthGuard],
})
export class BotModule {}
