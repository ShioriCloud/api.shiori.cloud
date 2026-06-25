export type ImageOutputFormat = 'webp' | 'avif';

type SharpFn = (
  input?: Buffer,
  options?: { animated?: boolean },
) => import('sharp').Sharp;

const MIME_EXT: Record<string, { mimetype: string; extension: string }> = {
  'image/jpeg': { mimetype: 'image/jpeg', extension: '.jpg' },
  'image/jpg': { mimetype: 'image/jpeg', extension: '.jpg' },
  'image/png': { mimetype: 'image/png', extension: '.png' },
  'image/webp': { mimetype: 'image/webp', extension: '.webp' },
  'image/gif': { mimetype: 'image/gif', extension: '.gif' },
  'image/avif': { mimetype: 'image/avif', extension: '.avif' },
};

let sharpUnavailableLogged = false;

/** Load sharp in CJS production (dynamic import can break native binding resolution). */
const loadSharp = (): SharpFn | null => {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const mod = require('sharp') as SharpFn | { default?: SharpFn; sharp?: SharpFn };
    const factory =
      typeof mod === 'function'
        ? mod
        : typeof mod.default === 'function'
          ? mod.default
          : mod.sharp;
    if (typeof factory !== 'function') {
      throw new Error('sharp export is not a function');
    }
    return factory;
  } catch (err) {
    if (!sharpUnavailableLogged) {
      sharpUnavailableLogged = true;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(
        `⚠️ sharp unavailable — media uploads will store originals without optimization: ${msg}`,
      );
    }
    return null;
  }
};

export type OptimizeImageOptions = {
  maxWidth: number;
  quality: number;
  format: ImageOutputFormat;
};

export type OptimizedImage = {
  buffer: Buffer;
  mimetype: string;
  extension: string;
};

const FORMAT_META: Record<ImageOutputFormat, { mimetype: string; extension: string }> = {
  webp: { mimetype: 'image/webp', extension: '.webp' },
  avif: { mimetype: 'image/avif', extension: '.avif' },
};

const passthroughOriginal = (input: Buffer, sourceMimetype: string): OptimizedImage => {
  const normalizedMime = sourceMimetype.toLowerCase();
  const meta = MIME_EXT[normalizedMime] ?? MIME_EXT['image/jpeg'];
  return {
    buffer: input,
    mimetype: meta.mimetype,
    extension: meta.extension,
  };
};

export async function optimizeImageBuffer(
  input: Buffer,
  sourceMimetype: string,
  options: OptimizeImageOptions,
): Promise<OptimizedImage> {
  const sharp = loadSharp();
  if (!sharp) {
    return passthroughOriginal(input, sourceMimetype);
  }

  const normalizedMime = sourceMimetype.toLowerCase();
  const meta = await sharp(input, { animated: true }).metadata();
  const isAnimated = (meta.pages ?? 1) > 1;

  if (normalizedMime === 'image/gif' && isAnimated) {
    return passthroughOriginal(input, sourceMimetype);
  }

  let pipeline = sharp(input, { animated: isAnimated })
    .rotate()
    .resize({
      width: options.maxWidth,
      withoutEnlargement: true,
      fit: 'inside',
    });

  const { mimetype, extension } = FORMAT_META[options.format];

  const buffer =
    options.format === 'avif'
      ? await pipeline.avif({ quality: options.quality }).toBuffer()
      : await pipeline.webp({ quality: options.quality }).toBuffer();

  return { buffer, mimetype, extension };
}
