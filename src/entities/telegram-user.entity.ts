import { Column, Entity, PrimaryColumn } from 'typeorm';

@Entity('telegram_users')
export class TelegramUser {
  @PrimaryColumn({ type: 'bigint', name: 'telegram_user_id' })
  telegramUserId: string;

  @Column({ type: 'text', name: 'first_name', default: '' })
  firstName: string;

  /** Optional public name; falls back to Telegram first_name when empty. */
  @Column({ type: 'text', name: 'social_display_name', nullable: true })
  socialDisplayName: string | null;

  @Column({ type: 'text', name: 'last_name', nullable: true })
  lastName: string | null;

  @Column({ type: 'text', nullable: true })
  username: string | null;

  @Column({ type: 'text', name: 'language_code', nullable: true })
  languageCode: string | null;

  @Column({ type: 'text', name: 'photo_url', nullable: true })
  photoUrl: string | null;

  @Column({ type: 'boolean', name: 'is_premium', default: false })
  isPremium: boolean;

  @Column({ type: 'text', name: 'app_role', default: 'user' })
  appRole: string;

  @Column({ type: 'text', name: 'admin_notes', nullable: true })
  adminNotes: string | null;

  @Column({ type: 'text', nullable: true })
  email: string | null;

  @Column({ type: 'text', name: 'password_hash', nullable: true })
  passwordHash: string | null;

  @Column({ type: 'boolean', name: 'portal_login_enabled', default: true })
  portalLoginEnabled: boolean;

  @Column({ type: 'timestamptz', name: 'first_seen_at', default: () => 'now()' })
  firstSeenAt: Date;

  @Column({ type: 'timestamptz', name: 'last_seen_at', default: () => 'now()' })
  lastSeenAt: Date;

  @Column({ type: 'int', name: 'visit_count', default: 1 })
  visitCount: number;

  @Column({ type: 'boolean', name: 'notify_new_episode', default: true })
  notifyNewEpisode: boolean;

  @Column({ type: 'boolean', name: 'notify_telegram_dm', default: true })
  notifyTelegramDm: boolean;

  /** In-app inbox when someone follows you. */
  @Column({ type: 'boolean', name: 'notify_social_follow', default: true })
  notifySocialFollow: boolean;

  /** In-app inbox when someone replies to your anime comment. */
  @Column({ type: 'boolean', name: 'notify_comment_reply', default: true })
  notifyCommentReply: boolean;

  /** In-app inbox when someone likes your anime comment (first like only). */
  @Column({ type: 'boolean', name: 'notify_comment_like', default: true })
  notifyCommentLike: boolean;

  /** When true, @username is hidden on social profile surfaces. */
  @Column({ type: 'boolean', name: 'hide_telegram_username', default: false })
  hideTelegramUsername: boolean;

  /** When true, watch list / activity is hidden from other users (and omitted from their feed). */
  @Column({ type: 'boolean', name: 'hide_watch_activity', default: false })
  hideWatchActivity: boolean;

  /** Free-download tokens (1 per free episode claim). New users start at 10. */
  @Column({ type: 'int', name: 'download_token_balance', default: 10 })
  downloadTokenBalance: number;

  /** Monthly subscription end; active while expires_at > now(). */
  @Column({ type: 'timestamptz', name: 'subscription_expires_at', nullable: true })
  subscriptionExpiresAt: Date | null;

  /** When true, mini-app + session auth are rejected. */
  @Column({ type: 'boolean', name: 'is_banned', default: false })
  isBanned: boolean;

  @Column({ type: 'timestamptz', name: 'banned_at', nullable: true })
  bannedAt: Date | null;

  @Column({ type: 'text', name: 'banned_reason', nullable: true })
  bannedReason: string | null;
}
