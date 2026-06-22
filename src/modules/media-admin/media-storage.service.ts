import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { randomUUID } from 'crypto';
import type { ReadStream } from 'fs';
import type { ImageOutputFormat } from './media-image.optimizer';
import { optimizeImageBuffer } from './media-image.optimizer';
import { sanitizeMediaBaseName } from './media-file-name.util';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

export type SavedImage = {
  fileName: string;
  storagePath: string;
  absolutePath: string;
  mimetype: string;
  size: number;
};

@Injectable()
export class MediaStorageService implements OnModuleInit {
  private readonly storageRoot: string;
  private readonly publicBaseUrl: string;
  private readonly maxUploadBytes: number;
  private readonly imageMaxWidth: number;
  private readonly imageQuality: number;
  private readonly imageFormat: ImageOutputFormat;

  constructor(private readonly config: ConfigService) {
    const configuredPath =
      this.config.get<string>('media.storagePath') ?? './data/uploads';
    this.storageRoot = resolve(process.cwd(), configuredPath);
    this.publicBaseUrl = (
      this.config.get<string>('media.publicBaseUrl') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    this.maxUploadBytes = this.config.get<number>('media.maxUploadBytes', 10 * 1024 * 1024);
    this.imageMaxWidth = this.config.get<number>('media.imageMaxWidth', 1920);
    this.imageQuality = this.config.get<number>('media.imageQuality', 82);
    this.imageFormat = this.config.get<ImageOutputFormat>('media.imageFormat', 'webp');
  }

  async onModuleInit(): Promise<void> {
    await mkdir(join(this.storageRoot, 'media'), { recursive: true });
  }

  getPublicUrl(id: string): string {
    return `${this.publicBaseUrl}/api/v1/media/serve/${id}`;
  }

  assertAllowedImage(file: Express.Multer.File): void {
    if (!file?.buffer?.length) {
      throw new BadRequestException('file is required');
    }

    if (file.size > this.maxUploadBytes) {
      throw new BadRequestException(
        `file exceeds max size of ${this.maxUploadBytes} bytes`,
      );
    }

    const mimetype = String(file.mimetype ?? '').toLowerCase();
    if (!IMAGE_MIME_TYPES.has(mimetype)) {
      throw new BadRequestException('only image uploads are supported');
    }
  }

  async saveImage(
    file: Express.Multer.File,
    preferredBaseName?: string,
  ): Promise<SavedImage> {
    this.assertAllowedImage(file);

    const sourceMimetype = String(file.mimetype ?? '').toLowerCase();
    const optimized = await optimizeImageBuffer(file.buffer, sourceMimetype, {
      maxWidth: this.imageMaxWidth,
      quality: this.imageQuality,
      format: this.imageFormat,
    });

    const fileName = preferredBaseName
      ? `${sanitizeMediaBaseName(preferredBaseName)}${optimized.extension}`
      : `${randomUUID()}${optimized.extension}`;
    const storagePath = join('media', fileName).replace(/\\/g, '/');
    const absolutePath = join(this.storageRoot, storagePath);

    await writeFile(absolutePath, optimized.buffer);

    return {
      fileName,
      storagePath,
      absolutePath,
      mimetype: optimized.mimetype,
      size: optimized.buffer.length,
    };
  }

  getAbsolutePath(storagePath: string): string {
    return join(this.storageRoot, storagePath);
  }

  fileExists(storagePath: string): boolean {
    return existsSync(this.getAbsolutePath(storagePath));
  }

  createReadStream(storagePath: string): ReadStream {
    return createReadStream(this.getAbsolutePath(storagePath));
  }

  async deleteFile(storagePath: string): Promise<void> {
    const absolutePath = this.getAbsolutePath(storagePath);
    if (!existsSync(absolutePath)) return;
    await unlink(absolutePath);
  }
}
