export const SUBSCRIPTION_DAYS = 30;

/** IRR amount that grants one month of subscription via Daramet. */
export const SUBSCRIPTION_MONTHLY_AMOUNT_IRR = 150_000;

export function hasActiveSubscription(
  expiresAt: Date | string | null | undefined,
  now: Date = new Date(),
): boolean {
  if (!expiresAt) return false;
  const t = expiresAt instanceof Date ? expiresAt.getTime() : Date.parse(String(expiresAt));
  return Number.isFinite(t) && t > now.getTime();
}

export function extendSubscriptionExpiry(
  currentExpiresAt: Date | string | null | undefined,
  days: number = SUBSCRIPTION_DAYS,
  now: Date = new Date(),
): Date {
  const currentMs = currentExpiresAt
    ? currentExpiresAt instanceof Date
      ? currentExpiresAt.getTime()
      : Date.parse(String(currentExpiresAt))
    : NaN;
  const base =
    Number.isFinite(currentMs) && currentMs > now.getTime()
      ? new Date(currentMs)
      : now;
  const next = new Date(base);
  next.setUTCDate(next.getUTCDate() + days);
  return next;
}
