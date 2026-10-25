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
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import { SocialBadgeEngineService } from './social-badge-engine.service';

type PortalRequest = { portalTelegramUserId?: string };

@ApiTags('Social Badges Admin')
@Controller('admin/social-badges')
@UseGuards(PortalAuthGuard, PortalFullAdminGuard)
export class SocialBadgesAdminController {
  constructor(private readonly badgeEngine: SocialBadgeEngineService) {}

  @Get('catalog')
  @ApiOperation({ summary: 'Badge definitions with earned user counts' })
  catalog() {
    return this.badgeEngine.getAdminCatalogSummary();
  }

  @Get('users/:telegramUserId')
  @ApiOperation({ summary: 'User badge progress and earned rows' })
  userBadges(@Param('telegramUserId') telegramUserId: string) {
    return this.badgeEngine.getAdminUserBadges(telegramUserId);
  }

  @Post('users/:telegramUserId/:badgeId/grant')
  @ApiOperation({ summary: 'Manually grant a badge' })
  async grant(
    @Param('telegramUserId') telegramUserId: string,
    @Param('badgeId') badgeId: string,
    @Body() body: { reason?: string },
    @Req() req: PortalRequest,
  ) {
    const actor = req.portalTelegramUserId ?? 'admin';
    await this.badgeEngine.grantBadgeAdmin(
      telegramUserId,
      badgeId,
      `admin:${actor}`,
    );
    return { ok: true, reason: body?.reason ?? null };
  }

  @Delete('users/:telegramUserId/:badgeId')
  @ApiOperation({ summary: 'Revoke an earned badge' })
  async revoke(
    @Param('telegramUserId') telegramUserId: string,
    @Param('badgeId') badgeId: string,
  ) {
    await this.badgeEngine.revokeBadgeAdmin(telegramUserId, badgeId);
    return { ok: true };
  }
}
