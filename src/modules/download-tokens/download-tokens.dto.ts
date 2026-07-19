import { Transform } from 'class-transformer';
import { IsInt, IsOptional, IsString, IsUUID, Min } from 'class-validator';

export class ClaimFreeDownloadDto {
  @IsUUID()
  episode_id!: string;
}

export class CreditDownloadTokensDto {
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
  tokens?: number;

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
  note?: string | null;
}
