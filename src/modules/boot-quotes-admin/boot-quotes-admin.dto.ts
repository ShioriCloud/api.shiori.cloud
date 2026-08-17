import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CreateBootQuoteDto {
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(200)
  attribution!: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  image_url?: string | null;
}

export class UpdateBootQuoteDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(500)
  text?: string;

  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  attribution?: string;

  @IsOptional()
  @IsBoolean()
  is_active?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(2000)
  image_url?: string | null;
}

export class ReorderBootQuotesDto {
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  ordered_ids!: string[];
}

export class ToggleBootQuoteDto {
  @Type(() => Boolean)
  @IsBoolean()
  is_active!: boolean;
}
