import {
  BadRequestException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  AnimeEpisode,
  DownloadTokenLedger,
  TelegramUser,
} from '../../entities';
import { tokensForDonationAmount } from './donation-token-tiers';

export type DownloadTokenReason =
  | 'signup_grant'
  | 'free_download'
  | 'donation_credit'
  | 'admin_grant';

@Injectable()
export class DownloadTokensService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(TelegramUser)
    private readonly usersRepo: Repository<TelegramUser>,
    @InjectRepository(AnimeEpisode)
    private readonly episodesRepo: Repository<AnimeEpisode>,
  ) {}

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

  async claimFreeDownload(
    telegramUserId: string,
    episodeId: string,
  ): Promise<{ balance: number; download_link: string }> {
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
}
