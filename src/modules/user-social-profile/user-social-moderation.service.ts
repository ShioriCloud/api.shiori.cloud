import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { UserSocialBlock, UserSocialFollow, UserSocialMute } from '../../entities';

@Injectable()
export class UserSocialModerationService {
  constructor(
    @InjectRepository(UserSocialBlock)
    private readonly blockRepo: Repository<UserSocialBlock>,
    @InjectRepository(UserSocialMute)
    private readonly muteRepo: Repository<UserSocialMute>,
    @InjectRepository(UserSocialFollow)
    private readonly followRepo: Repository<UserSocialFollow>,
  ) {}

  async arePeersBlocked(userA: string, userB: string): Promise<boolean> {
    const a = String(userA).trim();
    const b = String(userB).trim();
    if (!a || !b || a === b) return false;
    const count = await this.blockRepo.count({
      where: [
        { blockerTelegramUserId: a, blockedTelegramUserId: b },
        { blockerTelegramUserId: b, blockedTelegramUserId: a },
      ],
    });
    return count > 0;
  }

  async blockedPeerIds(viewerId: string): Promise<Set<string>> {
    const id = String(viewerId).trim();
    if (!id) return new Set();
    const rows = await this.blockRepo.find({
      where: [{ blockerTelegramUserId: id }, { blockedTelegramUserId: id }],
    });
    const peers = new Set<string>();
    for (const row of rows) {
      if (row.blockerTelegramUserId === id) {
        peers.add(String(row.blockedTelegramUserId));
      } else {
        peers.add(String(row.blockerTelegramUserId));
      }
    }
    return peers;
  }

  async mutedUserIds(muterId: string): Promise<Set<string>> {
    const id = String(muterId).trim();
    if (!id) return new Set();
    const rows = await this.muteRepo.find({
      where: { muterTelegramUserId: id },
      select: { mutedTelegramUserId: true },
    });
    return new Set(rows.map((r) => String(r.mutedTelegramUserId)));
  }

  async isMutedBy(muterId: string, mutedId: string): Promise<boolean> {
    return this.muteRepo.exists({
      where: {
        muterTelegramUserId: String(muterId).trim(),
        mutedTelegramUserId: String(mutedId).trim(),
      },
    });
  }

  async hasBlocked(blockerId: string, blockedId: string): Promise<boolean> {
    return this.blockRepo.exists({
      where: {
        blockerTelegramUserId: String(blockerId).trim(),
        blockedTelegramUserId: String(blockedId).trim(),
      },
    });
  }

  async blockUser(blockerId: string, blockedId: string): Promise<void> {
    const a = String(blockerId).trim();
    const b = String(blockedId).trim();
    const existing = await this.blockRepo.findOne({
      where: { blockerTelegramUserId: a, blockedTelegramUserId: b },
    });
    if (!existing) {
      await this.blockRepo.save({
        blockerTelegramUserId: a,
        blockedTelegramUserId: b,
      });
    }
    await this.muteRepo.delete({
      muterTelegramUserId: a,
      mutedTelegramUserId: b,
    });
    await this.followRepo.delete({
      followerTelegramUserId: a,
      followingTelegramUserId: b,
    });
    await this.followRepo.delete({
      followerTelegramUserId: b,
      followingTelegramUserId: a,
    });
  }

  async unblockUser(blockerId: string, blockedId: string): Promise<void> {
    await this.blockRepo.delete({
      blockerTelegramUserId: String(blockerId).trim(),
      blockedTelegramUserId: String(blockedId).trim(),
    });
  }

  async muteUser(muterId: string, mutedId: string): Promise<void> {
    const a = String(muterId).trim();
    const b = String(mutedId).trim();
    const exists = await this.muteRepo.findOne({
      where: { muterTelegramUserId: a, mutedTelegramUserId: b },
    });
    if (!exists) {
      await this.muteRepo.save({ muterTelegramUserId: a, mutedTelegramUserId: b });
    }
  }

  async unmuteUser(muterId: string, mutedId: string): Promise<void> {
    await this.muteRepo.delete({
      muterTelegramUserId: String(muterId).trim(),
      mutedTelegramUserId: String(mutedId).trim(),
    });
  }

  async listBlockedUserIds(blockerId: string): Promise<string[]> {
    const rows = await this.blockRepo.find({
      where: { blockerTelegramUserId: String(blockerId).trim() },
      order: { createdAt: 'DESC' },
    });
    return rows.map((r) => String(r.blockedTelegramUserId));
  }

  filterUserIds(ids: string[], excluded: Set<string>): string[] {
    if (excluded.size === 0) return ids;
    return ids.filter((id) => !excluded.has(String(id)));
  }
}
