import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  Min,
  ValidateIf,
} from 'class-validator';

export const USER_ANIME_LIST_STATUSES = [
  'planning',
  'watching',
  'completed',
  'rewatching',
  'paused',
  'dropped',
] as const;

export type UserAnimeListStatus = (typeof USER_ANIME_LIST_STATUSES)[number];

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
    if (value === null || value === undefined || value === '')
      return value ?? null;
    const n = Number(value);
    return Number.isFinite(n) ? n : value;
  })
  @ValidateIf((_, value) => value !== null && value !== undefined)
  @IsNumber()
  @Min(1)
  @Max(10)
  user_rating?: number | null;

  @IsOptional()
  @IsBoolean()
  is_favorite?: boolean;

  @IsOptional()
  @IsString()
  @IsIn([...USER_ANIME_LIST_STATUSES])
  list_status?: UserAnimeListStatus | null;
}

export class ReorderUserAnimeFavoritesDto {
  @IsArray()
  @ArrayMinSize(0)
  @ArrayMaxSize(500)
  @IsUUID('4', { each: true })
  anime_ids!: string[];
}
