import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export type DarametV2DonateRow = {
  donator?: unknown;
  donator_data?: {
    id?: number | string;
    message?: string | null;
    amount?: number;
    timestamp?: number;
    ref_id?: number | string;
  };
};

@Injectable()
export class DarametDonatesClient {
  private readonly logger = new Logger(DarametDonatesClient.name);

  constructor(private readonly config: ConfigService) {}

  private getApiKey(): string {
    return String(this.config.get<string>('daramet.apiKey') ?? '').trim();
  }

  isConfigured(): boolean {
    return this.getApiKey().length > 0;
  }

  async fetchAllDonatesPage(page = 1): Promise<DarametV2DonateRow[]> {
    const apiKey = this.getApiKey();
    if (!apiKey) return [];

    const res = await fetch('https://daramet.com/api/v2/Donates/All', {
      method: 'POST',
      headers: {
        Authorization: apiKey,
        Accept: 'application/json',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ page }),
    });

    const text = await res.text();
    if (!res.ok) {
      this.logger.warn(`Daramet All page=${page} failed: ${res.status} ${text.slice(0, 200)}`);
      return [];
    }

    if (!text.trim()) return [];
    try {
      const parsed = JSON.parse(text) as unknown;
      return Array.isArray(parsed) ? (parsed as DarametV2DonateRow[]) : [];
    } catch {
      this.logger.warn(`Daramet All page=${page} returned non-JSON`);
      return [];
    }
  }
}
