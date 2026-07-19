import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, Min } from 'class-validator';

export class AdminGrantSubscriptionDto {
  @IsString()
  telegram_user_id!: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number.parseInt(String(value), 10),
  )
  @IsInt()
  @Min(1)
  days?: number;

  @IsOptional()
  @IsString()
  note?: string | null;
}

export class ClaimEpisodeDownloadDto {
  @IsString()
  episode_id!: string;
}

export class ClaimEpisodePackDto {
  @IsString()
  anime_id!: string;
}

export class DarametSubscriptionWebhookDto {
  @IsOptional()
  @IsString()
  telegram_user_id?: string;

  @IsOptional()
  @Transform(({ value }) =>
    value === undefined || value === null || value === ''
      ? undefined
      : Number.parseInt(String(value), 10),
  )
  @IsInt()
  @Min(1)
  amount_irr?: number;

  @IsOptional()
  @IsString()
  payment_id?: string | null;

  @IsOptional()
  @IsString()
  note?: string | null;
}
