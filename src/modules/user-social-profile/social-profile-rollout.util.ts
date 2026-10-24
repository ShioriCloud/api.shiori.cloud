import type { DownloadTokenWalletMode } from '../download-tokens/download-token-wallet.util';

/** Social features are GA — no env rollout gate. */
export const SOCIAL_PROFILE_RESPONSE_MODE: DownloadTokenWalletMode = 'on';

export const isSocialProfileEnabledFor = (
  telegramUserId: string | number,
): boolean => {
  void telegramUserId;
  return true;
};
