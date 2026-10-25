export type BadgeCategoryKey =
  | 'adventure'
  | 'discovery'
  | 'marathon'
  | 'completion'
  | 'community'
  | 'legacy';

export type BadgeRarity = 'common' | 'rare' | 'epic' | 'legendary';

export type BadgeMetricKey =
  | 'user_registered'
  | 'unique_saved_anime'
  | 'unique_received_episodes'
  | 'unique_completed_anime'
  | 'approved_comments'
  | 'unique_commented_anime'
  | 'unique_rated_anime'
  | 'account_age_days'
  | 'loyalty_activity_ok';

export type BadgeCondition =
  | { kind: 'metric'; metric: BadgeMetricKey; target: number }
  | { kind: 'all'; parts: BadgeCondition[] };

export type BadgeDefinitionV1 = {
  id: string;
  category: BadgeCategoryKey;
  title: string;
  description: string;
  rarity: BadgeRarity;
  order: number;
  active: boolean;
  hidden?: boolean;
  hiddenTitle?: string;
  hiddenDescription?: string;
  imageUrl?: string;
  condition: BadgeCondition;
};

export const BADGE_CATEGORIES: Array<{
  id: BadgeCategoryKey;
  label: string;
  description: string;
  order: number;
}> = [
  {
    id: 'adventure',
    label: 'آغاز ماجراجویی',
    description: 'شروع فعالیت در شیوری',
    order: 1,
  },
  {
    id: 'discovery',
    label: 'شکارچی آرک‌ها',
    description: 'علاقه‌مندی‌ها و لیست تماشا',
    order: 2,
  },
  {
    id: 'marathon',
    label: 'ماراتن انیمه',
    description: 'دریافت قسمت‌های انیمه',
    order: 3,
  },
  {
    id: 'completion',
    label: 'فاتحان داستان',
    description: 'انیمه‌های تکمیل‌شده',
    order: 4,
  },
  {
    id: 'community',
    label: 'صدای فندوم',
    description: 'نظر و امتیاز',
    order: 5,
  },
  {
    id: 'legacy',
    label: 'افسانه‌های شیوری',
    description: 'قدمت و دستاوردهای ویژه',
    order: 6,
  },
];

/** V1 catalog — 16 active badges. */
export const BADGE_DEFINITIONS_V1: BadgeDefinitionV1[] = [
  {
    id: 'episode_zero',
    category: 'adventure',
    title: 'قسمت صفر',
    description: 'هر داستانی از یه جایی شروع می‌شه؛ اینجا شروع داستان توئه!',
    rarity: 'common',
    order: 10,
    active: true,
    /** Transparent PNG object art from mini-app `public/badges/{id}.png`. */
    imageUrl: '/badges/episode_zero.png',
    condition: { kind: 'metric', metric: 'user_registered', target: 1 },
  },
  {
    id: 'first_choice',
    category: 'adventure',
    title: 'اولین انتخاب',
    description: 'اولین انیمه‌ای که توی فهرستت جا باز می‌کنه، همیشه خاصه.',
    rarity: 'common',
    order: 20,
    active: true,
    condition: { kind: 'metric', metric: 'unique_saved_anime', target: 1 },
  },
  {
    id: 'arc_hunter',
    category: 'discovery',
    title: 'شکارچی آرک‌ها',
    description: 'یه ماجراجوی واقعی هیچ‌وقت به یه دنیا قانع نمی‌شه!',
    rarity: 'rare',
    order: 30,
    active: true,
    condition: { kind: 'metric', metric: 'unique_saved_anime', target: 10 },
  },
  {
    id: 'world_librarian',
    category: 'discovery',
    title: 'کتابدار دنیاها',
    description: 'از هر دنیا یه داستان، از هر داستان یه خاطره.',
    rarity: 'epic',
    order: 40,
    active: true,
    condition: { kind: 'metric', metric: 'unique_saved_anime', target: 30 },
  },
  {
    id: 'next_episode',
    category: 'marathon',
    title: 'قسمت بعدی!',
    description: 'ماجراجویی تازه شروع شده؛ قسمت بعدی منتظرته!',
    rarity: 'common',
    order: 50,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_received_episodes',
      target: 1,
    },
  },
  {
    id: 'marathon_watcher',
    category: 'marathon',
    title: 'ماراتن‌باز',
    description:
      'فقط یه قسمت دیگه... جمله‌ای که هیچ‌وقت به یه قسمت ختم نمی‌شه!',
    rarity: 'rare',
    order: 60,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_received_episodes',
      target: 25,
    },
  },
  {
    id: 'archive_guardian',
    category: 'marathon',
    title: 'نگهبان آرشیو',
    description: 'صد قسمت، صد ماجراجویی؛ و هنوز داستان‌های زیادی باقی مونده!',
    rarity: 'epic',
    order: 70,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_received_episodes',
      target: 100,
    },
  },
  {
    id: 'ending_credits',
    category: 'completion',
    title: 'تیتراژ پایانی',
    description: 'هر پایانی، شروع یه داستان تازه‌ست.',
    rarity: 'common',
    order: 80,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_completed_anime',
      target: 1,
    },
  },
  {
    id: 'arc_conqueror',
    category: 'completion',
    title: 'فاتح آرک‌ها',
    description: 'ده داستان رو تا آخر همراهی کردی؛ وقت آرک بعدیه!',
    rarity: 'rare',
    order: 90,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_completed_anime',
      target: 10,
    },
  },
  {
    id: 'ending_legend',
    category: 'completion',
    title: 'افسانه‌ی پایان‌ها',
    description: 'قهرمان‌های زیادی اومدن و رفتن؛ تو تا آخر قصه‌هاشون موندی.',
    rarity: 'epic',
    order: 100,
    active: true,
    condition: {
      kind: 'metric',
      metric: 'unique_completed_anime',
      target: 30,
    },
  },
  {
    id: 'first_dialogue',
    category: 'community',
    title: 'اولین دیالوگ',
    description: 'هر گفت‌وگوی ماندگاری از یه دیالوگ ساده شروع می‌شه.',
    rarity: 'common',
    order: 110,
    active: true,
    condition: { kind: 'metric', metric: 'approved_comments', target: 1 },
  },
  {
    id: 'fandom_voice',
    category: 'community',
    title: 'صدای فندوم',
    description: 'نظرت فقط یه کامنت نیست؛ بخشی از گفت‌وگوی طرفدارهاست.',
    rarity: 'rare',
    order: 120,
    active: true,
    condition: {
      kind: 'all',
      parts: [
        { kind: 'metric', metric: 'approved_comments', target: 10 },
        { kind: 'metric', metric: 'unique_commented_anime', target: 3 },
      ],
    },
  },
  {
    id: 'senpai_critic',
    category: 'community',
    title: 'منتقد سنپای',
    description: 'ستاره‌های تو به بقیه کمک می‌کنن داستان بعدی‌شون رو پیدا کنن.',
    rarity: 'rare',
    order: 130,
    active: true,
    condition: { kind: 'metric', metric: 'unique_rated_anime', target: 10 },
  },
  {
    id: 'shiori_senpai',
    category: 'legacy',
    title: 'سنپای شیوری',
    description: 'دیگه تازه‌وارد نیستی؛ حالا یکی از سنپای‌های شیوری هستی!',
    rarity: 'rare',
    order: 140,
    active: true,
    condition: {
      kind: 'all',
      parts: [
        { kind: 'metric', metric: 'account_age_days', target: 90 },
        { kind: 'metric', metric: 'loyalty_activity_ok', target: 1 },
      ],
    },
  },
  {
    id: 'shiori_veteran',
    category: 'legacy',
    title: 'کهنه‌کار شیوری',
    description:
      'یه سال از اولین آرک ما گذشته؛ خوشحالیم که هنوز بخشی از داستان مایی.',
    rarity: 'epic',
    order: 150,
    active: true,
    condition: {
      kind: 'all',
      parts: [
        { kind: 'metric', metric: 'account_age_days', target: 365 },
        { kind: 'metric', metric: 'loyalty_activity_ok', target: 1 },
      ],
    },
  },
  {
    id: 'hidden_gate',
    category: 'legacy',
    title: 'دروازه‌ی پنهان',
    description:
      'بعضی دروازه‌ها فقط برای ماجراجوهایی باز می‌شن که تمام مسیرها رو امتحان کردن.',
    rarity: 'legendary',
    order: 160,
    active: true,
    hidden: true,
    hiddenTitle: 'نشان مخفی',
    hiddenDescription: 'بعضی رازها فقط برای ماجراجوهای واقعی آشکار می‌شن.',
    condition: {
      kind: 'all',
      parts: [
        { kind: 'metric', metric: 'unique_saved_anime', target: 10 },
        { kind: 'metric', metric: 'unique_received_episodes', target: 25 },
        { kind: 'metric', metric: 'unique_completed_anime', target: 5 },
        { kind: 'metric', metric: 'approved_comments', target: 5 },
        { kind: 'metric', metric: 'unique_rated_anime', target: 5 },
      ],
    },
  },
];

export const ACTIVE_BADGE_IDS = new Set(
  BADGE_DEFINITIONS_V1.filter((b) => b.active).map((b) => b.id),
);

export const SOCIAL_BADGE_TOTAL_COUNT = BADGE_DEFINITIONS_V1.filter(
  (b) => b.active,
).length;

const DEF_BY_ID = new Map(BADGE_DEFINITIONS_V1.map((d) => [d.id, d]));

export const badgeDefinitionById = (id: string): BadgeDefinitionV1 | undefined =>
  DEF_BY_ID.get(id);

/** Safe 1:1 legacy ID remaps for earned rows (old social badges). */
export const LEGACY_BADGE_ID_MAP: Record<string, string> = {
  first_anime: 'first_choice',
  ten_anime: 'arc_hunter',
  commenter: 'first_dialogue',
  five_ratings: 'senpai_critic',
  hundred_eps: 'archive_guardian',
  five_hundred_eps: 'archive_guardian',
  month_watcher: 'shiori_senpai',
};

export const LEGACY_BADGE_IDS = new Set([
  'fifty_anime',
  'five_hundred_eps',
  'hundred_eps',
  'five_ratings',
  'twenty_ratings',
  'week_watcher',
  'marathon',
  'social_starter',
  'popular',
  'active_commenter',
  'curator',
  'hidden_marathon',
  'first_anime',
  'ten_anime',
  'commenter',
]);

export type BadgeUserMetrics = Record<BadgeMetricKey, number>;

export const metricValue = (
  metrics: BadgeUserMetrics,
  key: BadgeMetricKey,
): number => metrics[key] ?? 0;

export type ConditionProgressPart = {
  metric?: BadgeMetricKey;
  label: string;
  current: number;
  target: number;
  complete: boolean;
};

export const evaluateCondition = (
  metrics: BadgeUserMetrics,
  condition: BadgeCondition,
): { complete: boolean; parts: ConditionProgressPart[] } => {
  if (condition.kind === 'metric') {
    const current = metricValue(metrics, condition.metric);
    const complete = current >= condition.target;
    return {
      complete,
      parts: [
        {
          metric: condition.metric,
          label: condition.metric,
          current: Math.min(current, condition.target),
          target: condition.target,
          complete,
        },
      ],
    };
  }
  const parts: ConditionProgressPart[] = [];
  let complete = true;
  for (const part of condition.parts) {
    const ev = evaluateCondition(metrics, part);
    parts.push(...ev.parts);
    if (!ev.complete) complete = false;
  }
  return { complete, parts };
};

export const eligibleBadgeIdsV1 = (metrics: BadgeUserMetrics): string[] =>
  BADGE_DEFINITIONS_V1
    .filter((def) => def.active)
    .filter((def) => evaluateCondition(metrics, def.condition).complete)
    .sort((a, b) => a.order - b.order)
    .map((def) => def.id);
