import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Anime } from '../../entities';
import { UserCustomList } from '../../entities/user-custom-list.entity';
import { UserCustomListItem } from '../../entities/user-custom-list-item.entity';
import { UserCustomListsController } from './user-custom-lists.controller';
import { UserCustomListsService } from './user-custom-lists.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([UserCustomList, UserCustomListItem, Anime]),
  ],
  controllers: [UserCustomListsController],
  providers: [UserCustomListsService],
  exports: [UserCustomListsService],
})
export class UserCustomListsModule {}
