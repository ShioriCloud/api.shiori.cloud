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
import { sanitizeMediaBaseName } from './media-file-name.util';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const IMAGE_EXTENSION_BY_MIME: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
};

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

  constructor(private readonly config: ConfigService) {
    const configuredPath =
      this.config.get<string>('media.storagePath') ?? './data/uploads';
    this.storageRoot = resolve(process.cwd(), configuredPath);
    this.publicBaseUrl = (
      this.config.get<string>('media.publicBaseUrl') ?? 'http://localhost:3000'
    ).replace(/\/$/, '');
    this.maxUploadBytes = this.config.get<number>('media.maxUploadBytes', 10 * 1024 * 1024);
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
    const extension = IMAGE_EXTENSION_BY_MIME[sourceMimetype] ?? '.jpg';

    const fileName = preferredBaseName
      ? `${sanitizeMediaBaseName(preferredBaseName)}${extension}`
      : `${randomUUID()}${extension}`;
    const storagePath = join('media', fileName).replace(/\\/g, '/');
    const absolutePath = join(this.storageRoot, storagePath);

    await writeFile(absolutePath, file.buffer);

    return {
      fileName,
      storagePath,
      absolutePath,
      mimetype: sourceMimetype,
      size: file.buffer.length,
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
