export type DonationTokenTier = {
  amount_irr: number;
  tokens: number;
};

/** Suggested donation packages → tokens after payment is verified (Daramet webhook later). */
export const DONATION_TOKEN_TIERS: DonationTokenTier[] = [
  { amount_irr: 50_000, tokens: 10 },
  { amount_irr: 100_000, tokens: 25 },
  { amount_irr: 200_000, tokens: 60 },
];

/** Map a paid amount (IRR) to token credit using the highest matching tier. */
export function tokensForDonationAmount(amountIrr: number): number {
  const amount = Number(amountIrr);
  if (!Number.isFinite(amount) || amount <= 0) return 0;

  let best = 0;
  for (const tier of DONATION_TOKEN_TIERS) {
    if (amount >= tier.amount_irr) best = tier.tokens;
  }
  return best;
}
