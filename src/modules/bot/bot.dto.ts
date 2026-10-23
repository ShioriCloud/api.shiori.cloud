import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  Min,
} from 'class-validator';

export type BotArchiveLinkDto = {
  id: string;
  code: string;
  title?: string;
  type?: string;
  telegramFileId?: string;
  archiveChannelId?: string;
  archiveMessageId?: number;
  caption?: string;
};

export class BotArchiveLinkResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotArchiveLinkDto;
}

export class BotFileDto {
  @ApiProperty()
  key: string;

  @ApiPropertyOptional()
  messageId?: number;

  @ApiPropertyOptional()
  type?: string;

  @ApiPropertyOptional()
  fileId?: string;

  @ApiPropertyOptional()
  fileName?: string;

  @ApiPropertyOptional()
  fileSize?: number;

  @ApiPropertyOptional()
  caption?: string;

  @ApiPropertyOptional()
  downloads?: number;

  @ApiPropertyOptional()
  lastAccessed?: string;

  @ApiPropertyOptional()
  createdAt?: string;

  @ApiPropertyOptional()
  isActive?: boolean;
}

export class BotFileResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotFileDto;
}

export class BotOkResponseDto {
  @ApiProperty({ example: true })
  ok: true;
}

export class BotDownloadVisitorDto {
  @IsOptional()
  @IsInt()
  @Min(1)
  telegram_user_id?: number;

  @IsOptional()
  @IsString()
  first_name?: string;

  @IsOptional()
  @IsString()
  last_name?: string | null;

  @IsOptional()
  @IsString()
  username?: string | null;

  @IsOptional()
  @IsString()
  language_code?: string | null;

  @IsOptional()
  @IsBoolean()
  is_premium?: boolean;
}

export class CreateBotFileDto {
  @IsString()
  @IsNotEmpty()
  key: string;

  @IsOptional()
  @IsNumber()
  messageId?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @IsOptional()
  @IsString()
  caption?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  downloads?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpsertBotFileDto {
  @IsOptional()
  @IsNumber()
  messageId?: number;

  @IsOptional()
  @IsString()
  type?: string;

  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class UpdateBotFileByMessageDto {
  @IsOptional()
  @IsString()
  fileId?: string;

  @IsOptional()
  @IsString()
  fileName?: string;

  @IsOptional()
  @IsNumber()
  fileSize?: number;

  @IsOptional()
  @IsString()
  caption?: string;
}

export class BotModifiedCountDto {
  @ApiProperty()
  nModified: number;
}

export class BotModifiedCountResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotModifiedCountDto;
}

export class BotDeactivateCountDto {
  @ApiProperty()
  count: number;
}

export class BotDeactivateCountResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotDeactivateCountDto;
}

export class BotPackDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  slug: string;

  @ApiProperty()
  title: string;

  @ApiPropertyOptional()
  description?: string | null;

  @ApiProperty()
  isActive: boolean;

  @ApiPropertyOptional()
  createdAt?: string;
}

export class BotPackResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotPackDto;
}

export class BotPackItemDto {
  @ApiProperty()
  packId: string;

  @ApiProperty()
  fileKey: string;

  @ApiProperty()
  sortOrder: number;
}

export class BotPackItemsResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty({ type: [BotPackItemDto] })
  data: BotPackItemDto[];
}

export class BotSettingValueDto {
  @ApiProperty()
  value: string;
}

export class BotSettingResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotSettingValueDto;
}

export class SetBotSettingDto {
  @IsString()
  value: string;
}

export class BotSettingDeletedDto {
  @ApiProperty()
  deleted: boolean;
}

export class BotSettingDeletedResponseDto {
  @ApiProperty({ example: true })
  ok: true;

  @ApiProperty()
  data: BotSettingDeletedDto;
}
