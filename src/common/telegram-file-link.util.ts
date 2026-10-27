/** Parse `?start=get_<key>` or bare `get_<key>` (admin download links). */
export const parseTelegramFileDownloadKey = (link: string): string | null => {
  const raw = String(link ?? '').trim();
  if (!raw) return null;
  const fromUrl = raw.match(/[?&]start=get_([^&]+)/i)?.[1];
  if (fromUrl) {
    try {
      return decodeURIComponent(fromUrl).trim() || null;
    } catch {
      return fromUrl.trim() || null;
    }
  }
  const bare = raw.match(/^get_(.+)$/i)?.[1];
  if (!bare) return null;
  try {
    return decodeURIComponent(bare).trim() || null;
  } catch {
    return bare.trim() || null;
  }
};
