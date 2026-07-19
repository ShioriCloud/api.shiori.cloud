import {
  Body,
  Controller,
  Get,
  Headers,
  Post,
  Req,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import {
  AppUserAuthGuard,
  AppUserAuthedRequest,
} from '../../telegram/app-user-auth.guard';
import { PortalAuthGuard } from '../portal-auth/portal-auth.guard';
import { PortalFullAdminGuard } from '../portal-auth/portal-full-admin.guard';
import {
  SUBSCRIPTION_DAYS,
  SUBSCRIPTION_MONTHLY_AMOUNT_IRR,
} from './subscription.util';
import {
  AdminGrantSubscriptionDto,
  ClaimEpisodeDownloadDto,
  ClaimEpisodePackDto,
  DarametSubscriptionWebhookDto,
} from './subscriptions.dto';
import { SubscriptionsService } from './subscriptions.service';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptionsService: SubscriptionsService,
    private readonly config: ConfigService,
  ) {}

  @Get('plans')
  @ApiOperation({ summary: 'Public subscription plan info' })
  plans() {
    const days =
      this.config.get<number>('subscription.days') || SUBSCRIPTION_DAYS;
    const amount_irr =
      this.config.get<number>('subscription.monthlyAmountIrr') ||
      SUBSCRIPTION_MONTHLY_AMOUNT_IRR;
    return {
      plans: [
        {
          id: 'monthly',
          days,
          amount_irr,
          label: 'اشتراک ماهانه',
          benefits: [
            'دسترسی کامل سافت‌ساب',
            'دسترسی کامل هاردساب',
            'بدون مصرف توکن رایگان',
          ],
        },
      ],
    };
  }

  @Get('me')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({ summary: 'Current user subscription status' })
  me(@Req() req: AppUserAuthedRequest) {
    return this.subscriptionsService.getMe(String(req.telegramUserId));
  }

  @Post('episode-download/claim')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({
    summary: 'Claim softsub/hardsub download link (requires active subscription)',
  })
  claimEpisode(
    @Req() req: AppUserAuthedRequest,
    @Body() body: ClaimEpisodeDownloadDto,
  ) {
    return this.subscriptionsService.claimPaidEpisodeDownload(
      String(req.telegramUserId),
      body.episode_id,
    );
  }

  @Post('episode-pack/claim')
  @UseGuards(AppUserAuthGuard)
  @ApiOperation({
    summary: 'Claim episode pack link (requires active subscription)',
  })
  claimPack(
    @Req() req: AppUserAuthedRequest,
    @Body() body: ClaimEpisodePackDto,
  ) {
    return this.subscriptionsService.claimEpisodePack(
      String(req.telegramUserId),
      body.anime_id,
    );
  }

  @Post('admin-grant')
  @UseGuards(PortalAuthGuard, PortalFullAdminGuard)
  @ApiOperation({ summary: 'Admin grant/extend subscription days' })
  adminGrant(@Body() body: AdminGrantSubscriptionDto) {
    return this.subscriptionsService.grantDays({
      telegramUserId: body.telegram_user_id,
      days: body.days,
      note: body.note,
    });
  }

  /**
   * Daramet → monthly subscription.
   * Auth: x-daramet-webhook-secret or ALLOW_DEV_AUTH in local.
   * Body: telegram_user_id + amount_irr (>= monthly tier) → +30 days.
   */
  @Post('daramet-webhook')
  @ApiOperation({ summary: 'Daramet webhook: amount → +30d subscription' })
  async darametWebhook(
    @Headers('x-daramet-webhook-secret') secretHeader: string | undefined,
    @Body() body: DarametSubscriptionWebhookDto,
  ) {
    const expected = String(
      this.config.get<string>('daramet.webhookSecret') ?? '',
    ).trim();
    const allowDev = Boolean(this.config.get<boolean>('allowDevAuth'));
    const provided = String(secretHeader ?? '').trim();

    if (expected) {
      if (provided !== expected) {
        throw new UnauthorizedException('invalid daramet webhook secret');
      }
    } else if (!allowDev) {
      throw new UnauthorizedException(
        'daramet webhook secret not configured',
      );
    }

    const telegramUserId = String(body.telegram_user_id ?? '').trim();
    if (!telegramUserId) {
      throw new UnauthorizedException('telegram_user_id required');
    }
    if (typeof body.amount_irr !== 'number') {
      throw new UnauthorizedException('amount_irr required');
    }

    const result = await this.subscriptionsService.grantFromDonationAmount({
      telegramUserId,
      amountIrr: body.amount_irr,
      paymentId: body.payment_id,
      note: body.note,
    });

    return { ok: true, ...result };
  }
}
