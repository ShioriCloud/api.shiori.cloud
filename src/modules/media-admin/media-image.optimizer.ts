import sharp from 'sharp';

export type ImageOutputFormat = 'webp' | 'avif';

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

export async function optimizeImageBuffer(
  input: Buffer,
  sourceMimetype: string,
  options: OptimizeImageOptions,
): Promise<OptimizedImage> {
  const normalizedMime = sourceMimetype.toLowerCase();
  const meta = await sharp(input, { animated: true }).metadata();
  const isAnimated = (meta.pages ?? 1) > 1;

  if (normalizedMime === 'image/gif' && isAnimated) {
    return {
      buffer: input,
      mimetype: 'image/gif',
      extension: '.gif',
    };
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
