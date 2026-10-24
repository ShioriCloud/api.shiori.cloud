import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export class UpsertUserAnimeListDto {
  @IsString()
  @IsUUID()
  anime_id!: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(0)
  episodes_watched?: number;

  @IsOptional()
  @Transform(({ value }) => {
    if (value === null || value === undefined || value === '') return value ?? null
    const n = Number(value)
    return Number.isFinite(n) ? n : value
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(1)
  @Max(10)
  user_rating?: number | null;

  @IsOptional()
  @IsBoolean()
  is_favorite?: boolean;
}
