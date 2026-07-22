import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { SponsorCampaign, SponsorJoinEvent } from '../../entities';
import {
  AttributeSponsorJoinDto,
  CreateSponsorCampaignDto,
  ToggleSponsorCampaignDto,
  UpdateSponsorCampaignDto,
} from './sponsor-campaigns.dto';

export type SponsorCampaignAdminItem = {
  id: string;
  channel_id: string;
  channel_username: string | null;
  title: string;
  target_count: number;
  joined_count: number;
  is_active: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
};

export type SponsorCampaignBotItem = {
  id: string;
  channel_id: string;
  channel_username: string | null;
  title: string;
  target_count: number;
  joined_count: number;
  sort_order: number;
};

export type SponsorCampaignStats = {
  campaign: SponsorCampaignAdminItem;
  recent_joins: Array<{
    telegram_user_id: string;
    verified_at: string;
  }>;
};

export type AttributeJoinResult = {
  attributed: boolean;
  joined_count: number;
  is_active: boolean;
};

@Injectable()
export class SponsorCampaignsService {
  constructor(
    @InjectRepository(SponsorCampaign)
    private readonly campaignRepo: Repository<SponsorCampaign>,
    @InjectRepository(SponsorJoinEvent)
    private readonly joinEventRepo: Repository<SponsorJoinEvent>,
    private readonly dataSource: DataSource,
  ) {}

  async listCampaigns(): Promise<SponsorCampaignAdminItem[]> {
    const rows = await this.campaignRepo.find({
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return rows.map((row) => this.toAdminItem(row));
  }

  async getCampaign(id: string): Promise<SponsorCampaignAdminItem> {
    const row = await this.campaignRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Sponsor campaign not found');
    return this.toAdminItem(row);
  }

  async getCampaignStats(id: string): Promise<SponsorCampaignStats> {
    const campaign = await this.getCampaign(id);
    const recent = await this.joinEventRepo.find({
      where: { campaignId: id },
      order: { verifiedAt: 'DESC' },
      take: 50,
    });

    return {
      campaign,
      recent_joins: recent.map((event) => ({
        telegram_user_id: event.telegramUserId,
        verified_at: event.verifiedAt.toISOString(),
      })),
    };
  }

  async createCampaign(
    body: CreateSponsorCampaignDto,
  ): Promise<SponsorCampaignAdminItem> {
    return this.campaignRepo.manager.transaction(async (manager) => {
      const maxSort = await manager
        .createQueryBuilder(SponsorCampaign, 'c')
        .select('COALESCE(MAX(c.sortOrder), 0)', 'max')
        .getRawOne<{ max: string }>();

      const sortOrder =
        body.sort_order ?? Number.parseInt(maxSort?.max ?? '0', 10) + 1;

      const row = manager.create(SponsorCampaign, {
        channelId: body.channel_id.trim(),
        channelUsername: this.normalizeUsername(body.channel_username),
        title: body.title.trim(),
        targetCount: body.target_count,
        joinedCount: 0,
        isActive: body.is_active ?? true,
        sortOrder,
      });

      const saved = await manager.save(row);
      return this.toAdminItem(saved);
    });
  }

  async updateCampaign(
    id: string,
    body: UpdateSponsorCampaignDto,
  ): Promise<SponsorCampaignAdminItem> {
    const row = await this.campaignRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Sponsor campaign not found');

    if (body.channel_id !== undefined) {
      row.channelId = body.channel_id.trim();
    }
    if (body.channel_username !== undefined) {
      row.channelUsername = this.normalizeUsername(body.channel_username);
    }
    if (body.title !== undefined) {
      row.title = body.title.trim();
    }
    if (body.target_count !== undefined) {
      if (body.target_count < row.joinedCount) {
        throw new BadRequestException(
          'target_count cannot be less than joined_count',
        );
      }
      row.targetCount = body.target_count;
    }
    if (body.is_active !== undefined) {
      row.isActive = body.is_active;
    }
    if (body.sort_order !== undefined) {
      row.sortOrder = body.sort_order;
    }

    const saved = await this.campaignRepo.save(row);
    return this.toAdminItem(saved);
  }

  async toggleCampaign(
    id: string,
    body: ToggleSponsorCampaignDto,
  ): Promise<SponsorCampaignAdminItem> {
    const row = await this.campaignRepo.findOne({ where: { id } });
    if (!row) throw new NotFoundException('Sponsor campaign not found');
    row.isActive = body.is_active;
    const saved = await this.campaignRepo.save(row);
    return this.toAdminItem(saved);
  }

  async deleteCampaign(id: string): Promise<{ ok: true }> {
    const result = await this.campaignRepo.delete({ id });
    if (!result.affected) {
      throw new NotFoundException('Sponsor campaign not found');
    }
    return { ok: true };
  }

  async listActiveCampaigns(): Promise<{ ok: true; data: SponsorCampaignBotItem[] }> {
    const rows = await this.campaignRepo.find({
      where: { isActive: true },
      order: { sortOrder: 'ASC', createdAt: 'ASC' },
    });
    return {
      ok: true,
      data: rows.map((row) => this.toBotItem(row)),
    };
  }

  async attributeJoin(
    id: string,
    body: AttributeSponsorJoinDto,
  ): Promise<{ ok: true; data: AttributeJoinResult }> {
    const telegramUserId = String(body.telegram_user_id ?? '').trim();
    if (!telegramUserId) {
      throw new BadRequestException('telegram_user_id is required');
    }

    const result = await this.dataSource.transaction(async (manager) => {
      const campaign = await manager.findOne(SponsorCampaign, {
        where: { id, isActive: true },
        lock: { mode: 'pessimistic_write' },
      });

      if (!campaign) {
        return {
          attributed: false,
          joined_count: 0,
          is_active: false,
        };
      }

      const existing = await manager.findOne(SponsorJoinEvent, {
        where: { campaignId: id, telegramUserId },
      });

      if (existing) {
        return {
          attributed: false,
          joined_count: campaign.joinedCount,
          is_active: campaign.isActive,
        };
      }

      await manager.save(
        manager.create(SponsorJoinEvent, {
          campaignId: id,
          telegramUserId,
        }),
      );

      campaign.joinedCount += 1;
      if (campaign.joinedCount >= campaign.targetCount) {
        campaign.isActive = false;
      }

      const saved = await manager.save(campaign);
      return {
        attributed: true,
        joined_count: saved.joinedCount,
        is_active: saved.isActive,
      };
    });

    return { ok: true, data: result };
  }

  private normalizeUsername(value?: string | null): string | null {
    const trimmed = String(value ?? '').trim().replace(/^@/, '');
    return trimmed || null;
  }

  private toAdminItem(row: SponsorCampaign): SponsorCampaignAdminItem {
    return {
      id: row.id,
      channel_id: row.channelId,
      channel_username: row.channelUsername,
      title: row.title,
      target_count: row.targetCount,
      joined_count: row.joinedCount,
      is_active: row.isActive,
      sort_order: row.sortOrder,
      created_at: row.createdAt.toISOString(),
      updated_at: row.updatedAt.toISOString(),
    };
  }

  private toBotItem(row: SponsorCampaign): SponsorCampaignBotItem {
    return {
      id: row.id,
      channel_id: row.channelId,
      channel_username: row.channelUsername,
      title: row.title,
      target_count: row.targetCount,
      joined_count: row.joinedCount,
      sort_order: row.sortOrder,
    };
  }
}
