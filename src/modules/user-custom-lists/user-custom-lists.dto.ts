import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { USER_CUSTOM_LIST_ICONS } from '../../entities/user-custom-list.entity';

export class CreateUserCustomListDto {
  @IsOptional()
  @IsUUID()
  id?: string;

  @IsString()
  @MinLength(1)
  @MaxLength(48)
  name!: string;

  @IsOptional()
  @IsIn([...USER_CUSTOM_LIST_ICONS])
  icon?: (typeof USER_CUSTOM_LIST_ICONS)[number];

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}

export class UpdateUserCustomListDto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(48)
  name?: string;

  @IsOptional()
  @IsIn([...USER_CUSTOM_LIST_ICONS])
  icon?: (typeof USER_CUSTOM_LIST_ICONS)[number];

  @IsOptional()
  @IsBoolean()
  is_public?: boolean;
}

export class AddUserCustomListItemDto {
  @IsString()
  @IsUUID()
  anime_id!: string;
}

export class ReorderUserCustomListItemsDto {
  @IsArray()
  @ArrayMaxSize(500)
  @IsUUID(undefined, { each: true })
  @Type(() => String)
  anime_ids!: string[];
}
