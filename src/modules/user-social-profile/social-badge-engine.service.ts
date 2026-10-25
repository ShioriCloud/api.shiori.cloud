import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  UserSocialBadge,
  UserSocialBadgeShowcase,
} from '../../entities';
import {
  ACTIVE_BADGE_IDS,
  BADGE_CATEGORIES,
  BADGE_DEFINITIONS_V1,
  badgeDefinitionById,
  badgeUnlockHint,
  evaluateCondition,
  eligibleBadgeIdsV1,
  HIDDEN_BADGE_UNLOCK_GUIDE_FA,
  LEGACY_BADGE_ID_MAP,
  SOCIAL_BADGE_TOTAL_COUNT,
  type BadgeDefinitionV1,
  type BadgeUserMetrics,
} from './social-badge-catalog';
import { SocialBadgeMetricsService } from './social-badge-metrics.service';

export const SOCIAL_BADGE_NEW_MS = 14 * 24 * 60 * 60 * 1000;

export type EarnedBadgeMeta = {
  earned_at: string;
  is_new?: boolean;
  unlock_source?: string;
};

export type SocialBadgeCatalogItemDto = {
  id: string;
  title: string;
  display_title: string;
  description: string;
  category_id: string;
  category_label: string;
  rarity: string;
  hidden: boolean;
  hint: string | null;
  unlock_hint: string | null;
  earned: boolean;
  earned_at: string | null;
  is_new: boolean;
  progress: { current: number; target: number };
  progress_parts: Array<{
    label: string;
    current: number;
    target: number;
    complete: boolean;
  }>;
  image_url: string | null;
};

export type SocialBadgeCatalogResponse = {
  enabled: boolean;
  earned_count: number;
  total_count: number;
  showcase: string[];
  categories: Array<{
    id: string;
    label: string;
    badges: SocialBadgeCatalogItemDto[];
  }>;
};

export type SocialBadgePublicItemDto = {
  id: string;
  title: string;
  description: string;
  earned_at: string;
  is_new?: boolean;
  rarity: string;
  image_url: string | null;
};

export type SocialBadgePublicResponse = {
  enabled: boolean;
  earned_count: number;
  total_count: number;
  display_name: string;
  showcase: string[];
  badges: SocialBadgePublicItemDto[];
};

const METRIC_LABELS_FA: Record<string, string> = {
  user_registered: 'ثبت‌نام',
  unique_saved_anime: 'انیمه در لیست',
  unique_received_episodes: 'قسمت دریافت‌شده',
  unique_completed_anime: 'انیمه تکمیل‌شده',
  approved_comments: 'نظر تأییدشده',
  unique_commented_anime: 'انیمه با نظر',
  unique_rated_anime: 'انیمه امتیازدهی‌شده',
  account_age_days: 'روز عضویت',
  loyalty_activity_ok: 'فعالیت پس از آستانه',
};

@Injectable()
export class SocialBadgeEngineService {
  constructor(
    private readonly metricsService: SocialBadgeMetricsService,
    @InjectRepository(UserSocialBadge)
    private readonly badgeRepo: Repository<UserSocialBadge>,
    @InjectRepository(UserSocialBadgeShowcase)
    private readonly showcaseRepo: Repository<UserSocialBadgeShowcase>,
  ) {}

  normalizeBadgeId(badgeId: string): string {
    const id = String(badgeId).trim();
    return LEGACY_BADGE_ID_MAP[id] ?? id;
  }

  async syncEarnedBadges(
    telegramUserId: string,
    metrics: BadgeUserMetrics,
  ): Promise<Map<string, EarnedBadgeMeta>> {
    const userId = String(telegramUserId);
    const eligible = eligibleBadgeIdsV1(metrics);

    const existing = await this.badgeRepo.find({
      where: { telegramUserId: userId },
    });

    const legacyRemaps: UserSocialBadge[] = [];
    for (const row of existing) {
      const mapped = this.normalizeBadgeId(row.badgeId);
      if (mapped !== row.badgeId && ACTIVE_BADGE_IDS.has(mapped)) {
        const hasTarget = existing.some((e) => e.badgeId === mapped);
        if (!hasTarget) {
          row.badgeId = mapped;
          legacyRemaps.push(row);
        }
      }
    }
    if (legacyRemaps.length > 0) {
      await this.badgeRepo.save(legacyRemaps);
    }

    const earnedById = new Map(
      existing
        .filter((r) => ACTIVE_BADGE_IDS.has(this.normalizeBadgeId(r.badgeId)))
        .map((row) => [this.normalizeBadgeId(row.badgeId), row]),
    );

    const now = new Date();
    const toCreate = eligible
      .filter((id) => !earnedById.has(id))
      .map((badgeId) =>
        this.badgeRepo.create({
          telegramUserId: userId,
          badgeId,
          earnedAt: now,
          unlockSource: 'auto',
        }),
      );
    if (toCreate.length > 0) {
      await this.badgeRepo.save(toCreate);
      for (const row of toCreate) {
        earnedById.set(row.badgeId, row);
      }
    }

    const freshCutoff = Date.now() - SOCIAL_BADGE_NEW_MS;
    const meta = new Map<string, EarnedBadgeMeta>();
    for (const [id, row] of earnedById) {
      if (!ACTIVE_BADGE_IDS.has(id)) continue;
      meta.set(id, {
        earned_at: row.earnedAt.toISOString(),
        is_new: row.earnedAt.getTime() >= freshCutoff,
        unlock_source: row.unlockSource,
      });
    }
    return meta;
  }

  private buildCatalogItem(
    def: BadgeDefinitionV1,
    metrics: BadgeUserMetrics,
    earned: Map<string, EarnedBadgeMeta>,
    mode: 'self' | 'public',
  ): SocialBadgeCatalogItemDto | null {
    const isEarned = earned.has(def.id);
    const isHiddenLocked = def.hidden === true && !isEarned;

    if (mode === 'public' && isHiddenLocked) {
      return null;
    }

    const evaluation = evaluateCondition(metrics, def.condition);
    const aggCurrent = evaluation.parts.reduce((s, p) => s + p.current, 0);
    const aggTarget = evaluation.parts.reduce((s, p) => s + p.target, 0);

    const progressParts = isHiddenLocked
      ? []
      : evaluation.parts.map((p) => ({
          label: p.metric ? (METRIC_LABELS_FA[p.metric] ?? p.metric) : p.label,
          current: p.current,
          target: p.target,
          complete: p.complete,
        }));

    return {
      id: def.id,
      title: def.title,
      display_title: isHiddenLocked
        ? (def.hiddenTitle ?? '???')
        : def.title,
      description: isHiddenLocked
        ? (def.hiddenDescription ?? def.description)
        : def.description,
      category_id: def.category,
      category_label:
        BADGE_CATEGORIES.find((c) => c.id === def.category)?.label ??
        def.category,
      rarity: def.rarity,
      hidden: def.hidden === true,
      hint: isHiddenLocked ? (def.hiddenDescription ?? null) : null,
      unlock_hint: isHiddenLocked
        ? HIDDEN_BADGE_UNLOCK_GUIDE_FA
        : badgeUnlockHint(def),
      earned: isEarned,
      earned_at: earned.get(def.id)?.earned_at ?? null,
      is_new: earned.get(def.id)?.is_new === true,
      progress: isHiddenLocked
        ? { current: 0, target: 0 }
        : {
            current: aggCurrent,
            target: aggTarget,
          },
      progress_parts: progressParts,
      image_url: isEarned ? def.imageUrl ?? null : null,
    };
  }

  async getMyCatalog(telegramUserId: string): Promise<{
    metrics: BadgeUserMetrics;
    catalog: SocialBadgeCatalogResponse;
  }> {
    const metrics = await this.metricsService.collectForUser(telegramUserId);
    const earned = await this.syncEarnedBadges(telegramUserId, metrics);
    const showcase = await this.getShowcaseIds(telegramUserId);

    const categories = BADGE_CATEGORIES
      .slice()
      .sort((a, b) => a.order - b.order)
      .map((cat) => ({
        id: cat.id,
        label: cat.label,
        badges: BADGE_DEFINITIONS_V1
          .filter((d) => d.active && d.category === cat.id)
          .sort((a, b) => a.order - b.order)
          .map((def) => this.buildCatalogItem(def, metrics, earned, 'self'))
          .filter((item): item is SocialBadgeCatalogItemDto => item != null),
      }))
      .filter((c) => c.badges.length > 0);

    return {
      metrics,
      catalog: {
        enabled: true,
        earned_count: earned.size,
        total_count: SOCIAL_BADGE_TOTAL_COUNT,
        showcase,
        categories,
      },
    };
  }

  async getPublicDisplay(
    telegramUserId: string,
    displayName: string,
  ): Promise<SocialBadgePublicResponse> {
    const metrics = await this.metricsService.collectForUser(telegramUserId);
    const earned = await this.syncEarnedBadges(telegramUserId, metrics);
    const showcase = await this.getShowcaseIds(telegramUserId);

    const badges: SocialBadgePublicItemDto[] = [];
    for (const def of BADGE_DEFINITIONS_V1.filter((d) => d.active)) {
      if (!earned.has(def.id)) continue;
      if (def.hidden) {
        // earned hidden — reveal
      }
      badges.push({
        id: def.id,
        title: def.title,
        description: def.description,
        earned_at: earned.get(def.id)!.earned_at,
        is_new: earned.get(def.id)?.is_new,
        rarity: def.rarity,
        image_url: def.imageUrl ?? null,
      });
    }

    const ordered =
      showcase.length > 0
        ? showcase
            .map((id) => badges.find((b) => b.id === id))
            .filter((b): b is SocialBadgePublicItemDto => Boolean(b))
        : badges;

    return {
      enabled: true,
      earned_count: earned.size,
      total_count: SOCIAL_BADGE_TOTAL_COUNT,
      display_name: displayName,
      showcase,
      badges: ordered.length > 0 ? ordered : badges,
    };
  }

  async getShowcaseIds(telegramUserId: string): Promise<string[]> {
    const rows = await this.showcaseRepo.find({
      where: { telegramUserId: String(telegramUserId) },
      order: { slot: 'ASC' },
    });
    return rows.map((r) => r.badgeId);
  }

  async updateShowcase(
    telegramUserId: string,
    badgeIds: string[],
  ): Promise<string[]> {
    const unique = [...new Set(badgeIds.map((id) => String(id).trim()))].filter(
      Boolean,
    );
    if (unique.length > 3) {
      throw new BadRequestException('At most 3 showcase badges');
    }

    const userId = String(telegramUserId);
    const earnedRows = await this.badgeRepo.find({
      where: { telegramUserId: userId },
    });
    const earnedSet = new Set(
      earnedRows.map((e) => this.normalizeBadgeId(e.badgeId)),
    );
    for (const id of unique) {
      const norm = this.normalizeBadgeId(id);
      if (!ACTIVE_BADGE_IDS.has(norm) || !earnedSet.has(norm)) {
        throw new BadRequestException(`Badge not earned: ${id}`);
      }
    }

    await this.showcaseRepo.delete({ telegramUserId: userId });
    const rows = unique.map((badgeId, index) =>
      this.showcaseRepo.create({
        telegramUserId: userId,
        slot: index + 1,
        badgeId: this.normalizeBadgeId(badgeId),
      }),
    );
    if (rows.length > 0) {
      await this.showcaseRepo.save(rows);
    }
    return unique.map((id) => this.normalizeBadgeId(id));
  }

  /** Profile chip list — showcase first, then recent earned. */
  async getProfileBadgeChips(telegramUserId: string): Promise<
    Array<{
      id: string;
      title: string;
      image_url: string | null;
      rarity: string;
      is_new?: boolean;
    }>
  > {
    const { chips } = await this.syncForProfile(telegramUserId);
    return chips;
  }

  async syncForProfile(telegramUserId: string): Promise<{
    chips: Array<{
      id: string;
      title: string;
      image_url: string | null;
      rarity: string;
      is_new?: boolean;
    }>;
    earned_count: number;
    showcase: string[];
  }> {
    const metrics = await this.metricsService.collectForUser(telegramUserId);
    const earned = await this.syncEarnedBadges(telegramUserId, metrics);
    const showcase = await this.getShowcaseIds(telegramUserId);
    const freshCutoff = Date.now() - SOCIAL_BADGE_NEW_MS;

    const pick = (id: string) => {
      const def = badgeDefinitionById(id);
      if (!def || !earned.has(id)) return null;
      const at = earned.get(id)!.earned_at;
      return {
        id,
        title: def.title,
        image_url: def.imageUrl ?? null,
        rarity: def.rarity,
        is_new: new Date(at).getTime() >= freshCutoff,
      };
    };

    const fromShowcase = showcase
      .map(pick)
      .filter((x): x is NonNullable<typeof x> => x != null);

    const chips =
      fromShowcase.length > 0
        ? fromShowcase.slice(0, 3)
        : [...earned.keys()]
            .map((id) => pick(id))
            .filter((x): x is NonNullable<typeof x> => x != null)
            .slice(0, 3);

    return {
      chips,
      earned_count: earned.size,
      showcase,
    };
  }

  async grantBadgeAdmin(
    telegramUserId: string,
    badgeId: string,
    unlockSource = 'admin',
  ): Promise<void> {
    const norm = this.normalizeBadgeId(badgeId);
    if (!ACTIVE_BADGE_IDS.has(norm)) {
      throw new BadRequestException('Unknown badge');
    }
    const userId = String(telegramUserId);
    const existing = await this.badgeRepo.findOne({
      where: { telegramUserId: userId, badgeId: norm },
    });
    if (existing) return;
    await this.badgeRepo.save(
      this.badgeRepo.create({
        telegramUserId: userId,
        badgeId: norm,
        earnedAt: new Date(),
        unlockSource,
      }),
    );
  }

  async revokeBadgeAdmin(telegramUserId: string, badgeId: string): Promise<void> {
    const norm = this.normalizeBadgeId(badgeId);
    await this.badgeRepo.delete({
      telegramUserId: String(telegramUserId),
      badgeId: norm,
    });
    await this.showcaseRepo.delete({
      telegramUserId: String(telegramUserId),
      badgeId: norm,
    });
  }

  async getAdminCatalogSummary(): Promise<
    Array<{
      id: string;
      title: string;
      category: string;
      rarity: string;
      hidden: boolean;
      active: boolean;
      earned_count: number;
    }>
  > {
    const raw = await this.badgeRepo
      .createQueryBuilder('b')
      .select('b.badge_id', 'badge_id')
      .addSelect('COUNT(*)', 'cnt')
      .groupBy('b.badge_id')
      .getRawMany<{ badge_id: string; cnt: string }>();

    const counts = new Map<string, number>();
    for (const row of raw) {
      const id = this.normalizeBadgeId(String(row.badge_id));
      counts.set(id, (counts.get(id) ?? 0) + Number(row.cnt ?? 0));
    }

    return BADGE_DEFINITIONS_V1.filter((d) => d.active).map((d) => ({
      id: d.id,
      title: d.title,
      category: d.category,
      rarity: d.rarity,
      hidden: d.hidden === true,
      active: d.active,
      earned_count: counts.get(d.id) ?? 0,
    }));
  }

  async getAdminUserBadges(telegramUserId: string) {
    const { metrics, catalog } = await this.getMyCatalog(telegramUserId);
    const earnedRows = await this.badgeRepo.find({
      where: { telegramUserId: String(telegramUserId) },
    });
    return {
      metrics,
      showcase: catalog.showcase,
      earned_count: catalog.earned_count,
      total_count: catalog.total_count,
      catalog,
      earned_rows: earnedRows.map((r) => ({
        badge_id: this.normalizeBadgeId(r.badgeId),
        earned_at: r.earnedAt.toISOString(),
        unlock_source: r.unlockSource,
      })),
    };
  }
}
