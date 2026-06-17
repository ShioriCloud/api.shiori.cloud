import { IsNumber, IsOptional, IsString, IsUUID, Max, Min, ValidateIf } from 'class-validator';

export class UpsertUserAnimeListDto {
  @IsString()
  @IsUUID()
  anime_id!: string;

  @IsOptional()
  @IsNumber()
  @Min(0)
  episodes_watched?: number;

  @IsOptional()
  @ValidateIf((_, value) => value !== null)
  @IsNumber()
  @Min(1)
  @Max(10)
  user_rating?: number | null;
}
