import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserAnimeListEntry } from '../../entities';
import { UserAnimeListController } from './user-anime-list.controller';
import { UserAnimeListService } from './user-anime-list.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserAnimeListEntry])],
  controllers: [UserAnimeListController],
  providers: [UserAnimeListService],
})
export class UserAnimeListModule {}
