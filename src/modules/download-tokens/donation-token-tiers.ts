export type DonationTokenTier = {
  /** Package price in Tomans (Daramet Web Intent `donate` unit). */
  amount_irr: number;
  tokens: number;
};

/**
 * Suggested donation packages → tokens after payment is verified.
 * Amounts are Tomans (Daramet), not Rials.
 */
export const DONATION_TOKEN_TIERS: DonationTokenTier[] = [
  { amount_irr: 5_000, tokens: 10 },
  { amount_irr: 10_000, tokens: 25 },
  { amount_irr: 20_000, tokens: 60 },
];

/**
 * Map a paid amount to token credit using the highest matching tier.
 * `amount` must be in the same unit as tiers (Tomans).
 */
export function tokensForDonationAmount(amount: number): number {
  const value = Number(amount);
  if (!Number.isFinite(value) || value <= 0) return 0;

  let best = 0;
  for (const tier of DONATION_TOKEN_TIERS) {
    if (value >= tier.amount_irr) best = tier.tokens;
  }
  return best;
}

/**
 * Daramet Donates API `amount` is Rials (تومان × ۱۰). Convert to Tomans
 * for tier matching / Web Intent consistency.
 */
export function darametApiAmountToToman(amountFromApi: number): number {
  const raw = Number(amountFromApi);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.round(raw / 10);
}
