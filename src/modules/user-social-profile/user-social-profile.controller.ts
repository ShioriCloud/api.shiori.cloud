import { Controller, Get, Query, Req, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { UserSocialProfileService } from './user-social-profile.service';

@ApiTags('User Social Profile')
@Controller('user-social-profile')
@UseGuards(AppUserAuthGuard)
export class UserSocialProfileController {
  constructor(private readonly socialProfile: UserSocialProfileService) {}

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
    const pageNum = page ? parseInt(page, 10) : 1;
    const limitNum = limit ? parseInt(limit, 10) : 60;
    return this.socialProfile.getMe(
      String(req.telegramUserId),
      Number.isFinite(pageNum) ? pageNum : 1,
      Number.isFinite(limitNum) ? limitNum : 60,
    );
  }
}
