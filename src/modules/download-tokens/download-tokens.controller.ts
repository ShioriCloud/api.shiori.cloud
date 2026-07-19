import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Post,
  Req,
  UseGuards,
} from '@nestjs/common';
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
  constructor(private readonly downloadTokensService: DownloadTokensService) {}

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
    summary: 'Admin credit tokens (manual until Daramet webhook)',
  })
  credit(@Body() body: CreditDownloadTokensDto) {
    return this.downloadTokensService.creditTokens({
      telegramUserId: body.telegram_user_id,
      tokens: body.tokens,
      amountIrr: body.amount_irr,
      note: body.note,
      reason: body.amount_irr && !body.tokens ? 'donation_credit' : 'admin_grant',
    });
  }

  /**
   * Stub for future Daramet webhook.
   * Later: verify signature → tokensForDonationAmount(amount) → creditTokens.
   */
  @Post('daramet-webhook')
  @HttpCode(HttpStatus.NOT_IMPLEMENTED)
  @ApiOperation({
    summary: 'Daramet donation webhook (not implemented yet)',
  })
  darametWebhook() {
    return {
      ok: false,
      code: 'not_implemented',
      message:
        'Daramet webhook will credit download tokens from paid amount once connected.',
    };
  }
}
