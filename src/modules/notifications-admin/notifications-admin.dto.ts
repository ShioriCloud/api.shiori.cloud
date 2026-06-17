import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

export class ListNotificationCampaignsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '50'), 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;
}

export class NotifyEpisodeReleaseDto {
  @IsUUID()
  animeId!: string;

  @Transform(({ value }) => Number.parseInt(String(value), 10))
  @IsInt()
  @Min(1)
  episodeNumber!: number;

  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  sendTelegram?: boolean;

  @IsOptional()
  @IsString()
  miniAppBaseUrl?: string;
}
