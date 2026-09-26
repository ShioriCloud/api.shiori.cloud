import {
  getMaxPackedEpisodeEnd,
  isCaptionWithinPhotoBudget,
  replaceEpisodeLinesInCaption,
  TELEGRAM_PHOTO_CAPTION_MAX,
  telegramHtmlCaptionPlainLength,
} from './channel-caption.util';

describe('getMaxPackedEpisodeEnd', () => {
  it('returns 0 when no pack line is present', () => {
    expect(getMaxPackedEpisodeEnd('Title\n✅ <b>E01</b>: link')).toBe(0);
    expect(getMaxPackedEpisodeEnd('')).toBe(0);
  });

  it('parses P01 Episode [a-b] lines', () => {
    const caption =
      'Title\n✅ P01: Episode [01-12] (https://t.me/TheShioriSub/729)\n⬇️ <b>E13</b>: x';
    expect(getMaxPackedEpisodeEnd(caption)).toBe(12);
  });

  it('parses S01 Episode [a-b] lines with HTML wrappers', () => {
    const caption =
      '<tg-emoji emoji-id="1">✅</tg-emoji> <b>S01</b>: Episode <a href="https://t.me/x/1">[01-12]</a>';
    expect(getMaxPackedEpisodeEnd(caption)).toBe(12);
  });

  it('returns the highest end when multiple pack lines exist', () => {
    const caption =
      'P01: Episode [01-12]\nS02: Episode [13-24]\n⬇️ <b>E25</b>: x';
    expect(getMaxPackedEpisodeEnd(caption)).toBe(24);
  });
});

describe('replaceEpisodeLinesInCaption with pack lines', () => {
  it('keeps P01 pack line while replacing E## lines', () => {
    const template = [
      'Header',
      '✅ P01: Episode [01-12] (https://t.me/TheShioriSub/729)',
      '✅ <b>E13</b>: old',
      'Donation',
    ].join('\n');
    const out = replaceEpisodeLinesInCaption(template, [
      '⬇️ <b>E13</b>: new',
      '⬇️ <b>E14</b>: new',
    ]);
    expect(out).toContain('P01: Episode [01-12]');
    expect(out).toContain('<b>E13</b>: new');
    expect(out).toContain('<b>E14</b>: new');
    expect(out).not.toContain('E13</b>: old');
  });
});

describe('telegramHtmlCaptionPlainLength / photo budget', () => {
  it('strips tags when measuring length', () => {
    expect(telegramHtmlCaptionPlainLength('<b>hi</b>')).toBe(2);
    expect(
      telegramHtmlCaptionPlainLength(
        '<tg-emoji emoji-id="1">✅</tg-emoji> <b>E01</b>',
      ),
    ).toBe('✅ E01'.length);
  });

  it('rejects captions over the photo budget', () => {
    const long = 'x'.repeat(TELEGRAM_PHOTO_CAPTION_MAX + 1);
    expect(isCaptionWithinPhotoBudget(long)).toBe(false);
    expect(isCaptionWithinPhotoBudget('ok')).toBe(true);
  });
});
