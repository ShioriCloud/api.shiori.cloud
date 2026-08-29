import {
  buildMiniAppWelcomeKeyboard,
  buildMiniAppWelcomeText,
} from './mini-app-bot-welcome';

describe('mini-app-bot-welcome', () => {
  it('builds Persian welcome copy', () => {
    const text = buildMiniAppWelcomeText();
    expect(text).toContain('مینی‌شیوری');
    expect(text).toContain('تیکت پشتیبانی');
  });

  it('prefers web_app button when MINI_APP_URL is set', () => {
    const kb = buildMiniAppWelcomeKeyboard(
      'https://shiori.cloud',
      'ShioriMiniBot',
    );
    expect(kb.inline_keyboard[0][0].web_app?.url).toBe('https://shiori.cloud');
  });

  it('falls back to startapp url without MINI_APP_URL', () => {
    const kb = buildMiniAppWelcomeKeyboard('', 'ShioriMiniBot');
    expect(kb.inline_keyboard[0][0].url).toBe(
      'https://t.me/ShioriMiniBot?startapp',
    );
  });
});
