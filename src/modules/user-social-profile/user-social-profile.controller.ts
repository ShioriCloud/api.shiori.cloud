import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { UpdateSocialProfileDto } from './user-social-profile.dto';
import { UserSocialProfileService } from './user-social-profile.service';

const parsePageLimit = (page?: string, limit?: string) => {
  const pageNum = page ? parseInt(page, 10) : 1;
  const limitNum = limit ? parseInt(limit, 10) : 60;
  return {
    page: Number.isFinite(pageNum) ? pageNum : 1,
    limit: Number.isFinite(limitNum) ? limitNum : 60,
  };
};

const parseListPageLimit = (page?: string, limit?: string) => {
  const pageNum = page ? parseInt(page, 10) : 1;
  const limitNum = limit ? parseInt(limit, 10) : 30;
  return {
    page: Number.isFinite(pageNum) ? pageNum : 1,
    limit: Number.isFinite(limitNum) ? limitNum : 30,
  };
};

@ApiTags('User Social Profile')
@Controller('user-social-profile')
@UseGuards(AppUserAuthGuard)
export class UserSocialProfileController {
  constructor(private readonly socialProfile: UserSocialProfileService) {}

  @Get('me/badges')
  @ApiOperation({
    summary: 'Full badge catalog with per-badge progress (own profile)',
  })
  myBadges(@Req() req: AppUserAuthedRequest) {
    return this.socialProfile.getMyBadgeCatalog(String(req.telegramUserId));
  }

  @Get('users/:telegramUserId/badges')
  @ApiOperation({
    summary: 'Earned badges for another user (display-only sheet)',
  })
  userBadges(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
  ) {
    return this.socialProfile.getUserBadgeDisplay(
      String(req.telegramUserId),
      telegramUserId,
    );
  }

  @Get('me')
  @ApiOperation({
    summary:
      'Gated social profile stats (allowlist/on); enabled:false when rollout excludes user',
  })
  me(
    @Req() req: AppUserAuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parsePageLimit(page, limit);
    return this.socialProfile.getMe(String(req.telegramUserId), p, l);
  }

  @Patch('me')
  @ApiOperation({ summary: 'Update own public display name' })
  updateMe(
    @Req() req: AppUserAuthedRequest,
    @Body() body: UpdateSocialProfileDto,
  ) {
    return this.socialProfile.updateMe(
      String(req.telegramUserId),
      body.display_name,
    );
  }

  @Get('suggestions')
  @ApiOperation({ summary: 'Users to follow (friends-of-friends or popular)' })
  suggestions(
    @Req() req: AppUserAuthedRequest,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 10;
    return this.socialProfile.getFollowSuggestions(
      String(req.telegramUserId),
      Number.isFinite(limitNum) ? limitNum : 10,
    );
  }

  @Get('feed')
  @ApiOperation({ summary: 'Activity feed from users you follow' })
  feed(
    @Req() req: AppUserAuthedRequest,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parseListPageLimit(page, limit);
    return this.socialProfile.getFeed(String(req.telegramUserId), p, l);
  }

  @Get('search')
  @ApiOperation({ summary: 'Search users for social discovery' })
  search(
    @Req() req: AppUserAuthedRequest,
    @Query('q') q?: string,
    @Query('limit') limit?: string,
  ) {
    const limitNum = limit ? parseInt(limit, 10) : 20;
    return this.socialProfile.searchUsers(
      String(req.telegramUserId),
      q ?? '',
      Number.isFinite(limitNum) ? limitNum : 20,
    );
  }

  @Get('users/:telegramUserId')
  @ApiOperation({
    summary:
      'Public social profile for another user (viewer must be in rollout allowlist/on)',
  })
  getUser(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parsePageLimit(page, limit);
    return this.socialProfile.getUser(
      String(req.telegramUserId),
      telegramUserId,
      p,
      l,
    );
  }

  @Get('users/:telegramUserId/followers')
  @ApiOperation({ summary: 'Followers of a user (viewer must be in rollout)' })
  followers(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parseListPageLimit(page, limit);
    return this.socialProfile.listFollowers(
      String(req.telegramUserId),
      telegramUserId,
      p,
      l,
    );
  }

  @Get('users/:telegramUserId/following')
  @ApiOperation({
    summary: 'Users followed by target (viewer must be in rollout)',
  })
  following(
    @Req() req: AppUserAuthedRequest,
    @Param('telegramUserId') telegramUserId: string,
    @Query('page') page?: string,
    @Query('limit') limit?: string,
  ) {
    const { page: p, limit: l } = parseListPageLimit(page, limit);
    return this.socialProfile.listFollowing(
      String(req.telegramUserId),
      telegramUserId,
      p,
      l,
    );
  }

  @Post('follow/:targetTelegramUserId')
  @ApiOperation({ summary: 'Follow a user' })
  follow(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.follow(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }

  @Delete('follow/:targetTelegramUserId')
  @ApiOperation({ summary: 'Unfollow a user' })
  unfollow(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.unfollow(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }

  @Get('blocks')
  @ApiOperation({ summary: 'Users blocked by the current viewer' })
  listBlocks(@Req() req: AppUserAuthedRequest) {
    return this.socialProfile.listBlockedUsers(String(req.telegramUserId));
  }

  @Post('block/:targetTelegramUserId')
  @ApiOperation({ summary: 'Block a user' })
  block(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.blockUser(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }

  @Delete('block/:targetTelegramUserId')
  @ApiOperation({ summary: 'Unblock a user' })
  unblock(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.unblockUser(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }

  @Post('mute/:targetTelegramUserId')
  @ApiOperation({ summary: 'Mute a user (hide from feed)' })
  mute(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.muteUser(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }

  @Delete('mute/:targetTelegramUserId')
  @ApiOperation({ summary: 'Unmute a user' })
  unmute(
    @Req() req: AppUserAuthedRequest,
    @Param('targetTelegramUserId') targetTelegramUserId: string,
  ) {
    return this.socialProfile.unmuteUser(
      String(req.telegramUserId),
      targetTelegramUserId,
    );
  }
}
