import {
  buildMiniAppEpisodesUrl,
  channelDraftEpisodeLinkUrls,
  CHANNEL_DRAFT_MINI_APP_LINK_FROM_EPISODE,
  getMaxPackedEpisodeEnd,
  isCaptionWithinPhotoBudget,
  replaceEpisodeLinesInCaption,
  TELEGRAM_PHOTO_CAPTION_MAX,
  telegramHtmlCaptionPlainLength,
} from './channel-caption.util';

describe('channelDraftEpisodeLinkUrls', () => {
  const mini = buildMiniAppEpisodesUrl('ShioriMiniBot', 'my-anime');
  const botVideo = 'https://t.me/TheShioriBot?start=file_abc';
  const botSub = 'https://t.me/TheShioriBot?start=file_sub';

  it('keeps bot links for episodes below the mini-app threshold', () => {
    for (let n = 1; n < CHANNEL_DRAFT_MINI_APP_LINK_FROM_EPISODE; n++) {
      expect(
        channelDraftEpisodeLinkUrls({
          episodeNumber: n,
          botVideoUrl: botVideo,
          botSubtitleUrl: botSub,
          miniAppEpisodesUrl: mini,
        }),
      ).toEqual({ videoUrl: botVideo, subtitleUrl: botSub });
    }
  });

  it('uses mini-app episodes link for video and subtitle from threshold onward', () => {
    expect(
      channelDraftEpisodeLinkUrls({
        episodeNumber: CHANNEL_DRAFT_MINI_APP_LINK_FROM_EPISODE,
        botVideoUrl: botVideo,
        botSubtitleUrl: botSub,
        miniAppEpisodesUrl: mini,
      }),
    ).toEqual({ videoUrl: mini, subtitleUrl: mini });
  });
});

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

  it('parses P01 with HTML wrappers', () => {
    const caption =
      '<tg-emoji emoji-id="1">✅</tg-emoji> <b>P01</b>: Episode <a href="https://t.me/x/1">[01-12]</a>';
    expect(getMaxPackedEpisodeEnd(caption)).toBe(12);
  });

  it('ignores S## previous-season links so current-season E01 is not skipped', () => {
    // Ao Ashi S2 / Blue Box / Ranma S3 templates
    const caption =
      'Title\n⬇️ <b>E02</b>: x\n✅ S01: Episode [01-24] (https://t.me/TheShioriSub/1124)\nDonation';
    expect(getMaxPackedEpisodeEnd(caption)).toBe(0);

    const ranma =
      '✅S01: Episode [01-12]\n✅S02: Episode [01-06]\n⬇️ <b>E02</b>: x';
    expect(getMaxPackedEpisodeEnd(ranma)).toBe(0);
  });

  it('returns the highest end when multiple P-pack lines exist', () => {
    const caption =
      'P01: Episode [01-12]\nP02: Episode [13-24]\n⬇️ <b>E25</b>: x';
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
