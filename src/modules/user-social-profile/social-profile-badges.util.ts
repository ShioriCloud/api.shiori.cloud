export type SocialBadgeMetrics = {
  animeCount: number;
  episodesWatched: number;
  ratingsCount: number;
  activeDays: number;
  watchHours: number;
  followersCount: number;
  followingCount: number;
  commentsCount: number;
  publicListsCount: number;
};

export type SocialBadgeCategoryId = 'watch' | 'rating' | 'social' | 'lists';

export type SocialBadgeRarity = 'common' | 'rare' | 'hidden';

export type SocialBadgeProgress = { current: number; target: number };

export type SocialBadgeDefinition = {
  id: string;
  title: string;
  category: SocialBadgeCategoryId;
  order: number;
  description: string;
  rarity: SocialBadgeRarity;
  hidden?: boolean;
  hint?: string;
  image_url?: string;
  progress: (m: SocialBadgeMetrics) => SocialBadgeProgress;
  when: (m: SocialBadgeMetrics) => boolean;
};

export const SOCIAL_BADGE_CATEGORIES: Array<{
  id: SocialBadgeCategoryId;
  label: string;
  order: number;
}> = [
  { id: 'watch', label: 'تماشا', order: 1 },
  { id: 'rating', label: 'نمره‌دهی', order: 2 },
  { id: 'social', label: 'شبکه', order: 3 },
  { id: 'lists', label: 'لیست‌ها', order: 4 },
];

const metricProgress = (
  value: number,
  target: number,
): SocialBadgeProgress => ({
  current: Math.min(Math.max(0, value), target),
  target,
});

export const SOCIAL_BADGE_DEFINITIONS: SocialBadgeDefinition[] = [
  {
    id: 'first_anime',
    title: 'اولین انیمه',
    category: 'watch',
    order: 10,
    description: 'اولین انیمه را به لیست تماشا اضافه کن.',
    rarity: 'common',
    progress: (m) => metricProgress(m.animeCount, 1),
    when: (m) => m.animeCount >= 1,
  },
  {
    id: 'ten_anime',
    title: '۱۰ انیمه',
    category: 'watch',
    order: 20,
    description: '۱۰ انیمه در لیست تماشایت ثبت شود.',
    rarity: 'common',
    progress: (m) => metricProgress(m.animeCount, 10),
    when: (m) => m.animeCount >= 10,
  },
  {
    id: 'fifty_anime',
    title: '۵۰ انیمه',
    category: 'watch',
    order: 30,
    description: '۵۰ انیمه در لیست تماشایت ثبت شود.',
    rarity: 'rare',
    progress: (m) => metricProgress(m.animeCount, 50),
    when: (m) => m.animeCount >= 50,
  },
  {
    id: 'hundred_eps',
    title: '۱۰۰ قسمت',
    category: 'watch',
    order: 40,
    description: 'مجموع ۱۰۰ قسمت تماشا شده.',
    rarity: 'common',
    progress: (m) => metricProgress(m.episodesWatched, 100),
    when: (m) => m.episodesWatched >= 100,
  },
  {
    id: 'five_hundred_eps',
    title: '۵۰۰ قسمت',
    category: 'watch',
    order: 50,
    description: 'مجموع ۵۰۰ قسمت تماشا شده.',
    rarity: 'rare',
    progress: (m) => metricProgress(m.episodesWatched, 500),
    when: (m) => m.episodesWatched >= 500,
  },
  {
    id: 'week_watcher',
    title: '۷ روز فعال',
    category: 'watch',
    order: 60,
    description: 'در ۷ روز مختلف فعالیت تماشا داشته باش.',
    rarity: 'common',
    progress: (m) => metricProgress(m.activeDays, 7),
    when: (m) => m.activeDays >= 7,
  },
  {
    id: 'month_watcher',
    title: '۳۰ روز فعال',
    category: 'watch',
    order: 70,
    description: 'در ۳۰ روز مختلف فعالیت تماشا داشته باش.',
    rarity: 'rare',
    progress: (m) => metricProgress(m.activeDays, 30),
    when: (m) => m.activeDays >= 30,
  },
  {
    id: 'marathon',
    title: '۵۰ ساعت تماشا',
    category: 'watch',
    order: 80,
    description: 'حدود ۵۰ ساعت تماشا (بر اساس طول قسمت‌ها).',
    rarity: 'rare',
    progress: (m) => metricProgress(m.watchHours, 50),
    when: (m) => m.watchHours >= 50,
  },
  {
    id: 'five_ratings',
    title: '۵ نمره',
    category: 'rating',
    order: 90,
    description: 'به ۵ انیمه نمره بده.',
    rarity: 'common',
    progress: (m) => metricProgress(m.ratingsCount, 5),
    when: (m) => m.ratingsCount >= 5,
  },
  {
    id: 'twenty_ratings',
    title: '۲۰ نمره',
    category: 'rating',
    order: 100,
    description: 'به ۲۰ انیمه نمره بده.',
    rarity: 'rare',
    progress: (m) => metricProgress(m.ratingsCount, 20),
    when: (m) => m.ratingsCount >= 20,
  },
  {
    id: 'social_starter',
    title: 'شروع شبکه',
    category: 'social',
    order: 110,
    description: 'یک دنبال‌کننده بگیر یا ۵ نفر را دنبال کن.',
    rarity: 'common',
    progress: (m) => {
      if (m.followersCount >= 1) {
        return { current: 1, target: 1 };
      }
      return metricProgress(m.followingCount, 5);
    },
    when: (m) => m.followersCount >= 1 || m.followingCount >= 5,
  },
  {
    id: 'popular',
    title: '۱۰ دنبال‌کننده',
    category: 'social',
    order: 120,
    description: '۱۰ دنبال‌کننده در پروفایل عمومی.',
    rarity: 'rare',
    progress: (m) => metricProgress(m.followersCount, 10),
    when: (m) => m.followersCount >= 10,
  },
  {
    id: 'commenter',
    title: 'اولین نظر',
    category: 'social',
    order: 130,
    description: 'اولین نظرت روی یک انیمه ثبت شود.',
    rarity: 'common',
    progress: (m) => metricProgress(m.commentsCount, 1),
    when: (m) => m.commentsCount >= 1,
  },
  {
    id: 'active_commenter',
    title: '۱۰ نظر',
    category: 'social',
    order: 140,
    description: '۱۰ نظر روی انیمه‌ها (پس از تأیید).',
    rarity: 'common',
    progress: (m) => metricProgress(m.commentsCount, 10),
    when: (m) => m.commentsCount >= 10,
  },
  {
    id: 'curator',
    title: 'پلی‌لیست عمومی',
    category: 'lists',
    order: 150,
    description: 'یک پلی‌لیست عمومی بساز.',
    rarity: 'common',
    progress: (m) => metricProgress(m.publicListsCount, 1),
    when: (m) => m.publicListsCount >= 1,
  },
  {
    id: 'hidden_marathon',
    title: 'نشان مخفی',
    category: 'watch',
    order: 160,
    description: 'این یکی را خودت باید کشف کنی…',
    rarity: 'hidden',
    hidden: true,
    hint: 'سرنخ: ساعت تماشات مهمه — به یک آستانهٔ خاص از ساعت تماشا نزدیک شو.',
    progress: (m) => metricProgress(m.watchHours, 100),
    when: (m) => m.watchHours >= 100,
  },
];

export const SOCIAL_BADGE_TOTAL_COUNT = SOCIAL_BADGE_DEFINITIONS.length;

const BADGE_BY_ID = new Map(
  SOCIAL_BADGE_DEFINITIONS.map((def) => [def.id, def]),
);

const CATEGORY_LABEL = new Map(
  SOCIAL_BADGE_CATEGORIES.map((c) => [c.id, c.label]),
);

export const eligibleSocialBadgeIds = (metrics: SocialBadgeMetrics): string[] =>
  SOCIAL_BADGE_DEFINITIONS.filter((def) => def.when(metrics))
    .sort((a, b) => a.order - b.order)
    .map((def) => def.id);

export const socialBadgeTitle = (badgeId: string): string =>
  BADGE_BY_ID.get(badgeId)?.title ?? badgeId;

export const SOCIAL_BADGE_NEW_MS = 14 * 24 * 60 * 60 * 1000;

export type EarnedBadgeMeta = {
  earned_at: string;
  is_new?: boolean;
};

export type SocialBadgeCatalogItem = {
  id: string;
  title: string;
  display_title: string;
  description: string;
  category_id: SocialBadgeCategoryId;
  category_label: string;
  rarity: SocialBadgeRarity;
  hidden: boolean;
  hint: string | null;
  earned: boolean;
  earned_at: string | null;
  is_new: boolean;
  progress: SocialBadgeProgress;
  image_url: string | null;
};

export type SocialBadgeCatalogCategory = {
  id: SocialBadgeCategoryId;
  label: string;
  badges: SocialBadgeCatalogItem[];
};

export type SocialBadgeCatalogResponse = {
  enabled: boolean;
  earned_count: number;
  total_count: number;
  categories: SocialBadgeCatalogCategory[];
};

export type SocialBadgePublicItem = {
  id: string;
  title: string;
  description: string;
  earned_at: string;
  is_new?: boolean;
  image_url: string | null;
};

export type SocialBadgePublicResponse = {
  enabled: boolean;
  earned_count: number;
  total_count: number;
  display_name: string;
  badges: SocialBadgePublicItem[];
};

export const buildSocialBadgeCatalog = (
  metrics: SocialBadgeMetrics,
  earned: Map<string, EarnedBadgeMeta>,
): SocialBadgeCatalogResponse => {
  const byCategory = new Map<SocialBadgeCategoryId, SocialBadgeCatalogItem[]>();

  for (const def of SOCIAL_BADGE_DEFINITIONS) {
    const meta = earned.get(def.id);
    const isEarned = Boolean(meta);
    const showHidden = def.hidden === true && !isEarned;
    const item: SocialBadgeCatalogItem = {
      id: def.id,
      title: def.title,
      display_title: showHidden ? '???' : def.title,
      description: isEarned ? def.description : showHidden ? def.description : def.description,
      category_id: def.category,
      category_label: CATEGORY_LABEL.get(def.category) ?? def.category,
      rarity: def.rarity,
      hidden: def.hidden === true,
      hint: showHidden ? def.hint ?? null : null,
      earned: isEarned,
      earned_at: meta?.earned_at ?? null,
      is_new: meta?.is_new === true,
      progress: def.progress(metrics),
      image_url: isEarned ? def.image_url ?? null : null,
    };
    const list = byCategory.get(def.category) ?? [];
    list.push(item);
    byCategory.set(def.category, list);
  }

  const categories: SocialBadgeCatalogCategory[] = SOCIAL_BADGE_CATEGORIES
    .slice()
    .sort((a, b) => a.order - b.order)
    .map((cat) => ({
      id: cat.id,
      label: cat.label,
      badges: (byCategory.get(cat.id) ?? []).sort(
        (a, b) =>
          (BADGE_BY_ID.get(a.id)?.order ?? 0) -
          (BADGE_BY_ID.get(b.id)?.order ?? 0),
      ),
    }))
    .filter((cat) => cat.badges.length > 0);

  const earnedCount = earned.size;

  return {
    enabled: true,
    earned_count: earnedCount,
    total_count: SOCIAL_BADGE_TOTAL_COUNT,
    categories,
  };
};

export const buildSocialBadgePublicList = (
  earned: Map<string, EarnedBadgeMeta>,
  displayName: string,
): SocialBadgePublicResponse => {
  const badges: SocialBadgePublicItem[] = SOCIAL_BADGE_DEFINITIONS
    .filter((def) => earned.has(def.id))
    .sort((a, b) => a.order - b.order)
    .map((def) => {
      const meta = earned.get(def.id)!;
      return {
        id: def.id,
        title: def.title,
        description: def.description,
        earned_at: meta.earned_at,
        is_new: meta.is_new,
        image_url: def.image_url ?? null,
      };
    });

  return {
    enabled: true,
    earned_count: badges.length,
    total_count: SOCIAL_BADGE_TOTAL_COUNT,
    display_name: displayName,
    badges,
  };
};
