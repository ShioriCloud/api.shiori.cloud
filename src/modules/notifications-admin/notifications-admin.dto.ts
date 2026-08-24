import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsInt,
  IsNumber,
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

  @IsOptional()
  @IsString()
  before?: string;
}

export class SendBroadcastDto {
  @IsString()
  title!: string;

  @IsString()
  message!: string;

  @IsOptional()
  @IsString()
  href?: string;

  /** 'all' | 'airing_reminder' | 'in_list' — who receives the notification */
  @IsOptional()
  @IsString()
  audience?: string;

  /** Required when audience = 'airing_reminder' */
  @IsOptional()
  @IsUUID()
  animeId?: string;

  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  sendTelegram?: boolean;
}

export class NotifyEpisodeReleaseDto {
  @IsUUID()
  animeId!: string;

  @Transform(({ value }) => Number(value))
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  episodeNumber!: number;

  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  sendTelegram?: boolean;

  @IsOptional()
  @IsString()
  miniAppBaseUrl?: string;

  /** When true, create another campaign even if one already exists for this episode. */
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  forceResend?: boolean;
}
