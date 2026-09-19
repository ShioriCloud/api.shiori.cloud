import {
  buildDarametWebIntentUrl,
  isDownloadTokenWalletEnabledFor,
  parseDownloadTokenWalletMode,
  parseIdAllowlist,
  parseTelegramUserIdFromDonateMessage,
} from './download-token-wallet.util';

describe('download-token-wallet.util', () => {
  it('parses wallet modes', () => {
    expect(parseDownloadTokenWalletMode('off')).toBe('off');
    expect(parseDownloadTokenWalletMode('allowlist')).toBe('allowlist');
    expect(parseDownloadTokenWalletMode('on')).toBe('on');
  });

  it('respects allowlist', () => {
    const allow = parseIdAllowlist('1, 2');
    expect(isDownloadTokenWalletEnabledFor('1', 'allowlist', allow)).toBe(true);
    expect(isDownloadTokenWalletEnabledFor('9', 'allowlist', allow)).toBe(false);
    expect(isDownloadTokenWalletEnabledFor('9', 'off', allow)).toBe(false);
    expect(isDownloadTokenWalletEnabledFor('9', 'on', allow)).toBe(true);
  });

  it('parses telegram ids from donate messages', () => {
    expect(parseTelegramUserIdFromDonateMessage('90344148')).toBe('90344148');
    expect(parseTelegramUserIdFromDonateMessage('tg:90344148')).toBe('90344148');
    expect(parseTelegramUserIdFromDonateMessage('به عشق شیوری')).toBeNull();
  });

  it('builds webintent urls', () => {
    const url = buildDarametWebIntentUrl({
      donateBaseUrl: 'https://daramet.com/shiori',
      amountIrr: 100000,
      message: '90344148',
    });
    expect(url).toContain('webintent');
    expect(url).toContain('donate=100000');
    expect(url).toContain('message=90344148');
  });
});
