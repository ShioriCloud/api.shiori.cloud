import {
  eligibleBadgeIdsV1,
  evaluateCondition,
  SOCIAL_BADGE_TOTAL_COUNT,
  type BadgeUserMetrics,
} from './social-badge-catalog';

const baseMetrics = (): BadgeUserMetrics => ({
  user_registered: 1,
  unique_saved_anime: 0,
  unique_received_episodes: 0,
  unique_completed_anime: 0,
  approved_comments: 0,
  unique_commented_anime: 0,
  unique_rated_anime: 0,
  account_age_days: 0,
  loyalty_activity_ok: 0,
});

describe('social-badge-catalog', () => {
  it('defines 16 active badges', () => {
    expect(SOCIAL_BADGE_TOTAL_COUNT).toBe(16);
  });

  it('unlocks episode_zero when registered', () => {
    const ids = eligibleBadgeIdsV1(baseMetrics());
    expect(ids).toContain('episode_zero');
  });

  it('does not unlock arc_hunter below 10 saved anime', () => {
    const m = { ...baseMetrics(), unique_saved_anime: 9 };
    expect(eligibleBadgeIdsV1(m)).not.toContain('arc_hunter');
    m.unique_saved_anime = 10;
    expect(eligibleBadgeIdsV1(m)).toContain('arc_hunter');
  });

  it('requires both parts for fandom_voice', () => {
    const m = { ...baseMetrics(), approved_comments: 10, unique_commented_anime: 2 };
    expect(eligibleBadgeIdsV1(m)).not.toContain('fandom_voice');
    m.unique_commented_anime = 3;
    expect(eligibleBadgeIdsV1(m)).toContain('fandom_voice');
  });

  it('keeps earned hidden_gate conditions internal in evaluation only', () => {
    const m = {
      ...baseMetrics(),
      unique_saved_anime: 10,
      unique_received_episodes: 25,
      unique_completed_anime: 5,
      approved_comments: 5,
      unique_rated_anime: 5,
    };
    const ev = evaluateCondition(m, {
      kind: 'all',
      parts: [
        { kind: 'metric', metric: 'unique_saved_anime', target: 10 },
        { kind: 'metric', metric: 'unique_received_episodes', target: 25 },
      ],
    });
    expect(ev.complete).toBe(true);
    expect(eligibleBadgeIdsV1(m)).toContain('hidden_gate');
  });
});
