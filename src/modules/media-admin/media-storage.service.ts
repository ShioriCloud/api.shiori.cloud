import {
  BadRequestException,
  Injectable,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createReadStream, existsSync } from 'fs';
import { mkdir, unlink, writeFile } from 'fs/promises';
import { extname, join, resolve } from 'path';
import { randomUUID } from 'crypto';
import type { ReadStream } from 'fs';

const IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/jpg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
]);

const MIME_TO_EXT: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/avif': '.avif',
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
      this.config.get<string>('media.publicBaseUrl') ?? 'http://localhost:3001'
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

  resolveExtension(file: Express.Multer.File): string {
    const fromMime = MIME_TO_EXT[String(file.mimetype ?? '').toLowerCase()];
    if (fromMime) return fromMime;

    const fromName = extname(String(file.originalname ?? '')).toLowerCase();
    if (fromName) return fromName;

    return '.bin';
  }

  async saveImage(file: Express.Multer.File): Promise<{
    fileName: string;
    storagePath: string;
    absolutePath: string;
  }> {
    this.assertAllowedImage(file);

    const ext = this.resolveExtension(file);
    const fileName = `${randomUUID()}${ext}`;
    const storagePath = join('media', fileName).replace(/\\/g, '/');
    const absolutePath = join(this.storageRoot, storagePath);

    await writeFile(absolutePath, file.buffer);
    return { fileName, storagePath, absolutePath };
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
