import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { UpsertUserAnimeListDto } from './user-anime-list.dto';
import { UserAnimeListService } from './user-anime-list.service';

@ApiTags('User Anime List')
@Controller('user-anime-list')
@UseGuards(AppUserAuthGuard)
export class UserAnimeListController {
  constructor(private readonly userAnimeListService: UserAnimeListService) {}

  @Get()
  @ApiOperation({ summary: 'List current user favorites / watch progress' })
  list(@Req() req: AppUserAuthedRequest) {
    return this.userAnimeListService.list(String(req.telegramUserId));
  }

  @Post()
  @ApiOperation({ summary: 'Upsert list entry' })
  upsert(
    @Req() req: AppUserAuthedRequest,
    @Body() body: UpsertUserAnimeListDto,
  ) {
    return this.userAnimeListService.upsert(String(req.telegramUserId), body);
  }

  @Delete(':animeId')
  @ApiOperation({ summary: 'Remove anime from list' })
  remove(@Req() req: AppUserAuthedRequest, @Param('animeId') animeId: string) {
    return this.userAnimeListService.remove(
      String(req.telegramUserId),
      animeId,
    );
  }
}
