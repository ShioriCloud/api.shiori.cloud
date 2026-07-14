import { Transform } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

const FILE_SORT_FIELDS = [
  'downloads',
  'created_at',
  'last_accessed',
  'file_name',
  'key',
] as const;

export class ListFilesStatsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '1'), 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '20'), 10))
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;

  @IsOptional()
  @IsString()
  search?: string;

  @IsOptional()
  @IsIn(FILE_SORT_FIELDS)
  sortBy?: (typeof FILE_SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  activeOnly?: boolean;
}

export class FilePickerSearchBodyDto {
  @IsOptional()
  @IsString()
  query?: string;

  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  matchAnyTerms?: string[];

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsBoolean()
  activeOnly?: boolean;

  @IsOptional()
  @IsString()
  fileExtension?: string;
}

export class FilePickerSearchQueryDto extends FilePickerSearchBodyDto {
  @IsOptional()
  @Transform(({ value }) =>
    String(value ?? '')
      .split(',')
      .map((t) => t.trim())
      .filter(Boolean),
  )
  @IsArray()
  @IsString({ each: true })
  override matchAnyTerms?: string[];

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '20'), 10))
  @IsInt()
  @Min(1)
  @Max(100)
  override limit?: number;

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  override activeOnly?: boolean;
}

export class FilePickerRecentQueryDto {
  @IsString()
  fileExtension!: string;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '30'), 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @Transform(({ value }) => value !== 'false' && value !== false)
  @IsBoolean()
  activeOnly?: boolean;
}

export class FilePickerKeysQueryDto {
  @IsString()
  keys!: string;
}

export class UpsertFilePackDto {
  @IsOptional()
  @IsString()
  id?: string;

  @IsString()
  slug!: string;

  @IsString()
  title!: string;

  @IsOptional()
  @IsString()
  description?: string | null;

  @IsBoolean()
  is_active!: boolean;
}

export class AddFilePackItemDto {
  @IsString()
  file_key!: string;

  @IsInt()
  sort_order!: number;
}

export class UpdatePackItemSortDto {
  @IsInt()
  sort_order!: number;
}

export class ReorderFilePackItemsDto {
  @IsArray()
  @IsString({ each: true })
  ordered_file_keys!: string[];
}

const FILE_STATUS_FILTERS = ['all', 'active', 'inactive'] as const;

export class ListBotFilesQueryDto extends ListFilesStatsQueryDto {
  @IsOptional()
  @IsString()
  fileExtension?: string;

  @IsOptional()
  @IsIn(FILE_STATUS_FILTERS)
  status?: (typeof FILE_STATUS_FILTERS)[number];

  @IsOptional()
  @Transform(({ value }) => value === 'true' || value === true)
  @IsBoolean()
  orphanOnly?: boolean;
}

export class ResyncBotFileFromChannelDto {
  @IsString()
  @IsNotEmpty()
  channelId!: string;

  @IsInt()
  @Min(1)
  messageId!: number;
}

export class PatchBotFileMetadataDto {
  @IsOptional()
  @IsString()
  file_name?: string | null;

  @IsOptional()
  @IsString()
  caption?: string | null;
}
