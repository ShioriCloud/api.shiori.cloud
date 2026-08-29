export type MiniAppWelcomeKeyboard = {
  inline_keyboard: Array<
    Array<{
      text: string;
      url?: string;
      web_app?: { url: string };
    }>
  >;
};

/** Persian /start welcome for @ShioriMiniBot */
export function buildMiniAppWelcomeText(): string {
  return (
    '❤️ <b>به مینی‌شیوری خوش آمدید!</b>\n\n' +
    'مینی‌اپ رسمی <b>شیوری</b> برای مرور آرشیو انیمه، برنامهٔ پخش هفتگی، لیست شخصی و اعلان قسمت جدید.\n\n' +
    'ℹ️ هنوز در حال توسعه‌ایم — فیچرهای جدید به‌مرور اضافه می‌شوند.\n' +
    'اگر باگی دیدید، از بخش <b>تیکت پشتیبانی</b> داخل مینی‌اپ خبر بدید.\n\n' +
    '⬇️ برای شروع روی دکمهٔ زیر بزنید:'
  );
}

export function buildMiniAppWelcomeKeyboard(
  miniAppUrl: string,
  botUsername: string,
): MiniAppWelcomeKeyboard {
  const url = String(miniAppUrl ?? '').trim().replace(/\/$/, '');
  const bot = String(botUsername ?? 'ShioriMiniBot')
    .trim()
    .replace(/^@/, '');

  if (url) {
    return {
      inline_keyboard: [
        [{ text: '📥 ورود به مینی‌شیوری', web_app: { url } }],
      ],
    };
  }

  return {
    inline_keyboard: [
      [{ text: '📥 ورود به مینی‌شیوری', url: `https://t.me/${bot}?startapp` }],
    ],
  };
}

export function buildMiniAppWelcomeReplyMarkup(
  miniAppUrl: string,
  botUsername: string,
): { reply_markup: MiniAppWelcomeKeyboard } {
  return {
    reply_markup: buildMiniAppWelcomeKeyboard(miniAppUrl, botUsername),
  };
}
