import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class RegisterTelegramUserDto {
  @IsInt()
  @Min(1)
  telegram_user_id!: number;

  @IsString()
  first_name!: string;

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
  @IsString()
  photo_url?: string | null;

  @IsOptional()
  @IsBoolean()
  is_premium?: boolean;
}
