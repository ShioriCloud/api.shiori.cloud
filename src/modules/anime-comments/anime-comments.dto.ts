import { IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';

export class CreateAnimeCommentDto {
  @IsString()
  anime_id!: string;

  @IsString()
  @MinLength(1)
  @MaxLength(1000)
  body!: string;

  @IsOptional()
  @IsUUID()
  parent_id?: string;
}

export class ReportAnimeCommentDto {
  @IsOptional()
  @IsString()
  @MaxLength(240)
  reason?: string;
}
