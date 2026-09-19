import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AnimeEpisode,
  DownloadTokenLedger,
  TelegramUser,
} from '../../entities';
import { DarametDonatesClient } from './daramet-donates.client';
import { DONATION_TOKEN_TIERS, tokensForDonationAmount } from './donation-token-tiers';
import {
  buildDarametWebIntentUrl,
  isDownloadTokenWalletEnabledFor,
  parseDownloadTokenWalletMode,
  parseIdAllowlist,
  parseTelegramUserIdFromDonateMessage,
  type DownloadTokenWalletMode,
} from './download-token-wallet.util';

export type DownloadTokenReason =
  | 'signup_grant'
  | 'free_download'
  | 'donation_credit'
  | 'admin_grant';

export type DownloadTokenWalletStatus = {
  wallet_enabled: boolean;
  mode: DownloadTokenWalletMode;
  balance: number;
  tiers: Array<{ amount_irr: number; tokens: number; recharge_url: string | null }>;
  daramet_configured: boolean;
};

@Injectable()
export class DownloadTokensService {
  private readonly logger = new Logger(DownloadTokensService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly config: ConfigService,
    private readonly darametClient: DarametDonatesClient,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(AnimeEpisode)
    private readonly episodesRepo: Repository<AnimeEpisode>,
    @InjectRepository(DownloadTokenLedger)
    private readonly ledgerRepo: Repository<DownloadTokenLedger>,
  ) {}

  private walletMode(): DownloadTokenWalletMode {
    return parseDownloadTokenWalletMode(
      this.config.get<string>('downloadTokens.walletMode'),
    );
  }

  private walletAllowlist(): Set<string> {
    return parseIdAllowlist(
      this.config.get<string>('downloadTokens.walletAllowlist'),
    );
  }

  isWalletEnabledFor(telegramUserId: string): boolean {
    return isDownloadTokenWalletEnabledFor(
      telegramUserId,
      this.walletMode(),
      this.walletAllowlist(),
    );
  }

  private assertWalletEnabled(telegramUserId: string): void {
    if (!this.isWalletEnabledFor(telegramUserId)) {
      throw new ForbiddenException({
        code: 'token_wallet_disabled',
        message: 'download token wallet is not enabled for this user',
      });
    }
  }

  private donateBaseUrl(): string {
    return (
      String(this.config.get<string>('daramet.donateUrl') ?? '').trim() ||
      'https://daramet.com'
    );
  }

  private async ensureUser(telegramUserId: string): Promise<TelegramUser> {
    let user = await this.usersRepo.findOne({
      where: { telegramUserId },
    });
    if (user) return user;

    user = this.usersRepo.create({
      telegramUserId,
      firstName: 'کاربر',
      downloadTokenBalance: 10,
    });
    return this.usersRepo.save(user);
  }

  async getBalance(telegramUserId: string): Promise<{ balance: number }> {
    const user = await this.ensureUser(telegramUserId);
    return { balance: user.downloadTokenBalance ?? 0 };
  }

  async getWalletStatus(telegramUserId: string): Promise<DownloadTokenWalletStatus> {
    const mode = this.walletMode();
    const walletEnabled = this.isWalletEnabledFor(telegramUserId);
    const balance = walletEnabled
      ? (await this.getBalance(telegramUserId)).balance
      : 0;
    const donateBase = this.donateBaseUrl();

    const tiers = DONATION_TOKEN_TIERS.map((tier) => ({
      amount_irr: tier.amount_irr,
      tokens: tier.tokens,
      recharge_url: walletEnabled
        ? buildDarametWebIntentUrl({
            donateBaseUrl: donateBase,
            amountIrr: tier.amount_irr,
            message: String(telegramUserId),
          })
        : null,
    }));

    return {
      wallet_enabled: walletEnabled,
      mode,
      balance,
      tiers,
      daramet_configured: this.darametClient.isConfigured(),
    };
  }

  async claimFreeDownload(
    telegramUserId: string,
    episodeId: string,
  ): Promise<{ balance: number; download_link: string }> {
    this.assertWalletEnabled(telegramUserId);

    const episode = await this.episodesRepo.findOne({
      where: { id: episodeId },
    });
    if (!episode) {
      throw new NotFoundException('episode not found');
    }
    if (String(episode.videoFileType ?? '').trim().toLowerCase() !== 'free') {
      throw new BadRequestException('episode is not a free download');
    }

    const downloadLink =
      episode.downloadLink?.trim() ||
      `https://t.me/ShioriUploadBot?start=get_${episode.id}`;

    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(TelegramUser);
      const ledger = manager.getRepository(DownloadTokenLedger);

      let user = await users.findOne({
        where: { telegramUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        await users.save(
          users.create({
            telegramUserId,
            firstName: 'کاربر',
            downloadTokenBalance: 10,
          }),
        );
        user = await users.findOne({
          where: { telegramUserId },
          lock: { mode: 'pessimistic_write' },
        });
      }
      if (!user) {
        throw new NotFoundException('user not found');
      }

      const balance = user.downloadTokenBalance ?? 0;
      if (balance < 1) {
        throw new HttpException(
          {
            code: 'insufficient_tokens',
            message: 'download tokens exhausted',
            balance: 0,
          },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }

      const next = balance - 1;
      user.downloadTokenBalance = next;
      await users.save(user);

      await ledger.save(
        ledger.create({
          telegramUserId,
          delta: -1,
          balanceAfter: next,
          reason: 'free_download',
          refType: 'episode',
          refId: episodeId,
          note: null,
        }),
      );

      return { balance: next, download_link: downloadLink };
    });
  }

  async creditTokens(input: {
    telegramUserId: string;
    tokens?: number;
    amountIrr?: number;
    note?: string | null;
    reason?: Extract<DownloadTokenReason, 'donation_credit' | 'admin_grant'>;
    refType?: string | null;
    refId?: string | null;
  }): Promise<{ balance: number; credited: number }> {
    const telegramUserId = String(input.telegramUserId).trim();
    if (!telegramUserId) {
      throw new BadRequestException('telegram_user_id required');
    }

    let credited = 0;
    if (typeof input.tokens === 'number' && Number.isFinite(input.tokens)) {
      credited = Math.floor(input.tokens);
    } else if (
      typeof input.amountIrr === 'number' &&
      Number.isFinite(input.amountIrr)
    ) {
      credited = tokensForDonationAmount(input.amountIrr);
    }

    if (credited < 1) {
      throw new BadRequestException(
        'tokens or amount_irr must resolve to at least 1 token',
      );
    }

    const reason = input.reason ?? 'admin_grant';

    return this.dataSource.transaction(async (manager) => {
      const users = manager.getRepository(TelegramUser);
      const ledger = manager.getRepository(DownloadTokenLedger);

      if (input.refType && input.refId) {
        const existing = await ledger.findOne({
          where: {
            refType: input.refType,
            refId: String(input.refId),
          },
        });
        if (existing) {
          const user = await users.findOne({ where: { telegramUserId } });
          return {
            balance: user?.downloadTokenBalance ?? 0,
            credited: 0,
          };
        }
      }

      let user = await users.findOne({
        where: { telegramUserId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!user) {
        await users.save(
          users.create({
            telegramUserId,
            firstName: 'کاربر',
            downloadTokenBalance: 10,
          }),
        );
        user = await users.findOne({
          where: { telegramUserId },
          lock: { mode: 'pessimistic_write' },
        });
      }
      if (!user) {
        throw new NotFoundException('user not found');
      }

      const next = (user.downloadTokenBalance ?? 0) + credited;
      user.downloadTokenBalance = next;
      await users.save(user);

      await ledger.save(
        ledger.create({
          telegramUserId,
          delta: credited,
          balanceAfter: next,
          reason,
          refType: input.refType ?? null,
          refId: input.refId ?? null,
          note: input.note?.trim() || null,
        }),
      );

      return { balance: next, credited };
    });
  }

  /**
   * Poll Daramet donations and credit token wallets (idempotent by donate id).
   */
  async syncDarametDonations(input?: {
    pages?: number;
  }): Promise<{
    scanned: number;
    credited: number;
    skipped: number;
    unmatched: number;
  }> {
    if (!this.darametClient.isConfigured()) {
      throw new BadRequestException('DARAMET_API_KEY is not configured');
    }

    const pages = Math.max(1, Math.min(10, Math.floor(input?.pages ?? 1)));
    let scanned = 0;
    let credited = 0;
    let skipped = 0;
    let unmatched = 0;

    for (let page = 1; page <= pages; page += 1) {
      const rows = await this.darametClient.fetchAllDonatesPage(page);
      for (const row of rows) {
        scanned += 1;
        const data = row.donator_data;
        const donateId = data?.id;
        if (donateId == null) {
          skipped += 1;
          continue;
        }

        const refId = String(donateId);
        const already = await this.ledgerRepo.findOne({
          where: { refType: 'daramet_donate', refId },
        });
        if (already) {
          skipped += 1;
          continue;
        }

        const telegramUserId = parseTelegramUserIdFromDonateMessage(data?.message);
        if (!telegramUserId) {
          unmatched += 1;
          continue;
        }

        // Only credit users in the wallet rollout (allowlist/on).
        if (!this.isWalletEnabledFor(telegramUserId)) {
          unmatched += 1;
          continue;
        }

        const amountIrr = Number(data?.amount ?? 0);
        const tokens = tokensForDonationAmount(amountIrr);
        if (tokens < 1) {
          skipped += 1;
          continue;
        }

        const result = await this.creditTokens({
          telegramUserId,
          tokens,
          amountIrr,
          reason: 'donation_credit',
          refType: 'daramet_donate',
          refId,
          note: `daramet donate ${refId} amount_irr=${amountIrr}`,
        });

        if (result.credited > 0) {
          credited += 1;
          this.logger.log(
            `Daramet credit user=${telegramUserId} tokens=${result.credited} donate=${refId}`,
          );
        } else {
          skipped += 1;
        }
      }
    }

    return { scanned, credited, skipped, unmatched };
  }
}
