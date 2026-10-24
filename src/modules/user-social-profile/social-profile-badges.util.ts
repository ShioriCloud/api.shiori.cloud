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

export type SocialBadgeDefinition = {
  id: string;
  title: string;
  order: number;
  when: (m: SocialBadgeMetrics) => boolean;
};

export const SOCIAL_BADGE_DEFINITIONS: SocialBadgeDefinition[] = [
  {
    id: 'first_anime',
    title: 'اولین انیمه',
    order: 10,
    when: (m) => m.animeCount >= 1,
  },
  {
    id: 'ten_anime',
    title: '۱۰ انیمه',
    order: 20,
    when: (m) => m.animeCount >= 10,
  },
  {
    id: 'fifty_anime',
    title: '۵۰ انیمه',
    order: 30,
    when: (m) => m.animeCount >= 50,
  },
  {
    id: 'hundred_eps',
    title: '۱۰۰ قسمت',
    order: 40,
    when: (m) => m.episodesWatched >= 100,
  },
  {
    id: 'five_hundred_eps',
    title: '۵۰۰ قسمت',
    order: 50,
    when: (m) => m.episodesWatched >= 500,
  },
  {
    id: 'five_ratings',
    title: '۵ نمره',
    order: 60,
    when: (m) => m.ratingsCount >= 5,
  },
  {
    id: 'twenty_ratings',
    title: '۲۰ نمره',
    order: 70,
    when: (m) => m.ratingsCount >= 20,
  },
  {
    id: 'week_watcher',
    title: '۷ روز فعال',
    order: 80,
    when: (m) => m.activeDays >= 7,
  },
  {
    id: 'month_watcher',
    title: '۳۰ روز فعال',
    order: 90,
    when: (m) => m.activeDays >= 30,
  },
  {
    id: 'marathon',
    title: '۵۰ ساعت تماشا',
    order: 100,
    when: (m) => m.watchHours >= 50,
  },
  {
    id: 'social_starter',
    title: 'شروع شبکه',
    order: 110,
    when: (m) => m.followersCount >= 1 || m.followingCount >= 5,
  },
  {
    id: 'popular',
    title: '۱۰ دنبال‌کننده',
    order: 120,
    when: (m) => m.followersCount >= 10,
  },
  {
    id: 'commenter',
    title: 'اولین نظر',
    order: 130,
    when: (m) => m.commentsCount >= 1,
  },
  {
    id: 'active_commenter',
    title: '۱۰ نظر',
    order: 140,
    when: (m) => m.commentsCount >= 10,
  },
  {
    id: 'curator',
    title: 'پلی‌لیست عمومی',
    order: 150,
    when: (m) => m.publicListsCount >= 1,
  },
];

const BADGE_BY_ID = new Map(
  SOCIAL_BADGE_DEFINITIONS.map((def) => [def.id, def]),
);

export const eligibleSocialBadgeIds = (metrics: SocialBadgeMetrics): string[] =>
  SOCIAL_BADGE_DEFINITIONS.filter((def) => def.when(metrics))
    .sort((a, b) => a.order - b.order)
    .map((def) => def.id);

export const socialBadgeTitle = (badgeId: string): string =>
  BADGE_BY_ID.get(badgeId)?.title ?? badgeId;

export const SOCIAL_BADGE_NEW_MS = 14 * 24 * 60 * 60 * 1000;
