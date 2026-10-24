import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import {
  AddUserCustomListItemDto,
  CreateUserCustomListDto,
  ReorderUserCustomListItemsDto,
  UpdateUserCustomListDto,
} from './user-custom-lists.dto';
import { UserCustomListsService } from './user-custom-lists.service';

@ApiTags('User Custom Lists')
@Controller('user-custom-lists')
@UseGuards(AppUserAuthGuard)
export class UserCustomListsController {
  constructor(private readonly customListsService: UserCustomListsService) {}

  @Get()
  @ApiOperation({ summary: 'List custom Shiori lists for the current user' })
  list(@Req() req: AppUserAuthedRequest) {
    return this.customListsService.list(String(req.telegramUserId));
  }

  @Get('users/:telegramUserId/public')
  @ApiOperation({ summary: 'Public custom lists for another user' })
  listPublic(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
  ) {
    return this.customListsService.listPublicForUser(
      String(req.telegramUserId),
      telegramUserId,
    );
  }

  @Get('users/:telegramUserId/public/:listId')
  @ApiOperation({ summary: 'One public custom list with anime cards' })
  getPublic(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
    @Param('listId') listId: string,
  ) {
    return this.customListsService.getPublicList(
      String(req.telegramUserId),
      telegramUserId,
      listId,
    );
  }

  @Post()
  @ApiOperation({ summary: 'Create a custom list (max 5)' })
  create(
    @Req() req: AppUserAuthedRequest,
    @Body() body: CreateUserCustomListDto,
  ) {
    return this.customListsService.create(String(req.telegramUserId), body);
  }

  @Patch(':id')
  @ApiOperation({ summary: 'Rename or change icon of a custom list' })
  update(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Body() body: UpdateUserCustomListDto,
  ) {
    return this.customListsService.update(String(req.telegramUserId), id, body);
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Delete a custom list' })
  remove(@Req() req: AppUserAuthedRequest, @Param('id') id: string) {
    return this.customListsService.remove(String(req.telegramUserId), id);
  }

  @Post(':id/items')
  @ApiOperation({ summary: 'Add an anime to a custom list' })
  addItem(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Body() body: AddUserCustomListItemDto,
  ) {
    return this.customListsService.addItem(String(req.telegramUserId), id, body);
  }

  @Put(':id/items/order')
  @ApiOperation({ summary: 'Reorder items in a custom list' })
  reorderItems(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Body() body: ReorderUserCustomListItemsDto,
  ) {
    return this.customListsService.reorderItems(
      String(req.telegramUserId),
      id,
      body,
    );
  }

  @Delete(':id/items/:animeId')
  @ApiOperation({ summary: 'Remove an anime from a custom list' })
  removeItem(
    @Req() req: AppUserAuthedRequest,
    @Param('id') id: string,
    @Param('animeId') animeId: string,
  ) {
    return this.customListsService.removeItem(
      String(req.telegramUserId),
      id,
      animeId,
    );
  }
}
