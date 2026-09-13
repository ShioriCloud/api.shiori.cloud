import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsObject,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';
import type { HomeBlockType } from '../../entities/home-block.entity';

/** Creatable / assignable types — system_rail is seeded and not created via API. */
const HOME_BLOCK_TYPES: HomeBlockType[] = [
  'curated_slider',
  'cta_banner',
  'cta_card',
];

export class CreateHomeBlockDto {
  @IsIn(HOME_BLOCK_TYPES)
  type!: HomeBlockType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class UpdateHomeBlockDto {
  @IsOptional()
  @IsIn(HOME_BLOCK_TYPES)
  type?: HomeBlockType;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  title?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(200)
  subtitle?: string | null;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string | null;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsObject()
  config?: Record<string, unknown>;
}

export class ReorderHomeBlocksDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ordered_ids!: string[];
}

export class ToggleHomeBlockDto {
  @Type(() => Boolean)
  @IsBoolean()
  is_active!: boolean;
}
