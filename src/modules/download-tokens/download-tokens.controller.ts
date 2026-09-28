import {
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import { DONATION_TOKEN_TIERS } from './donation-token-tiers';
import {
  ClaimFreeDownloadDto,
  CreditDownloadTokensDto,
} from './download-tokens.dto';
import { DownloadTokensService } from './download-tokens.service';

@ApiTags('Download Tokens')
@Controller('download-tokens')
export class DownloadTokensController {
  constructor(
    private readonly downloadTokensService: DownloadTokensService,
    private readonly config: ConfigService,
  ) {}

  @Get('tiers')
  @ApiOperation({ summary: 'Donation amount → token packages (for donate UI)' })
  tiers() {
    return { tiers: DONATION_TOKEN_TIERS };
  }

  @Get('balance')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({ summary: 'Current free-download token balance' })
  balance(@Req() req: AppUserAuthedRequest) {
    return this.downloadTokensService.getBalance(String(req.telegramUserId));
  }

  @Get('wallet')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({
    summary:
      'Token wallet status for current user (allowlist/on) + Daramet recharge links',
  })
  wallet(@Req() req: AppUserAuthedRequest) {
    return this.downloadTokensService.getWalletStatus(String(req.telegramUserId));
  }

  @Post('wallet/refresh')
  @UseGuards(AppUserAuthGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Poll recent Daramet donations then return updated wallet (I paid button)',
  })
  async walletRefresh(@Req() req: AppUserAuthedRequest) {
    const telegramUserId = String(req.telegramUserId);
    this.downloadTokensService.assertWalletEnabledPublic(telegramUserId);
    const sync = await this.downloadTokensService.syncDarametDonations({
      pages: 2,
    });
    const wallet =
      await this.downloadTokensService.getWalletStatus(telegramUserId);
    return { wallet, credited: sync.credited, sync };
  }

  @Post('free-download/claim')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({ summary: 'Spend 1 token and return free episode download link' })
  claim(
    @Req() req: AppUserAuthedRequest,
    @Body() body: ClaimFreeDownloadDto,
  ) {
    return this.downloadTokensService.claimFreeDownload(
      String(req.telegramUserId),
      body.episode_id,
    );
  }

  @Post('credit')
  @UseGuards(PortalAuthGuard, PortalFullAdminGuard)
  @ApiOperation({
    summary: 'Admin credit tokens (manual or amount→tier mapping)',
  })
  credit(
    @Body() body: CreditDownloadTokensDto,
    @Req() req: { portalTelegramUserId?: string },
  ) {
    return this.downloadTokensService.creditTokens({
      telegramUserId: body.telegram_user_id,
      tokens: body.tokens,
      amountIrr: body.amount_irr,
      note: body.note,
      reason: body.amount_irr && !body.tokens ? 'donation_credit' : 'admin_grant',
      actorTelegramUserId: req.portalTelegramUserId,
    });
  }

  @Post('daramet-sync')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Poll Daramet donations and credit wallets (x-cron-secret)',
  })
  async darametSync(@Headers('x-cron-secret') cronSecret: string | undefined) {
    const expected = String(this.config.get<string>('cron.secret') ?? '').trim();
    const provided = String(cronSecret ?? '').trim();
    const allowDev = Boolean(this.config.get<boolean>('allowDevAuth'));

    if (expected) {
      if (provided !== expected) {
        throw new UnauthorizedException('invalid cron secret');
      }
    } else if (!allowDev) {
      throw new UnauthorizedException('CRON_SECRET not configured');
    }

    const result = await this.downloadTokensService.syncDarametDonations({
      pages: 2,
    });
    return { ok: true, ...result };
  }

  @Post('daramet-sync/admin')
  @UseGuards(PortalAuthGuard, PortalFullAdminGuard)
  @ApiOperation({ summary: 'Admin-triggered Daramet donation sync' })
  async darametSyncAdmin() {
    const result = await this.downloadTokensService.syncDarametDonations({
      pages: 3,
    });
    return { ok: true, ...result };
  }

  @Post('daramet-webhook')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Daramet has no push webhook — use daramet-sync poll instead',
  })
  darametWebhook() {
    return {
      ok: false,
      code: 'use_daramet_sync',
      message:
        'Use POST /download-tokens/daramet-sync with x-cron-secret to poll Daramet donations.',
    };
  }
}
