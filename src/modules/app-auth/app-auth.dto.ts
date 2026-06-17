import { IsEmail, IsOptional, IsString, IsUUID, MinLength } from 'class-validator';

export class AppRegisterDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(8)
  password!: string;

  @IsString()
  @MinLength(1)
  display_name!: string;
}

export class AppLoginDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class LinkTelegramCredentialsDto {
  @IsEmail()
  email!: string;

  @IsString()
  @MinLength(1)
  password!: string;
}

export class CompleteTelegramLinkDto {
  @IsUUID()
  token!: string;
}

export class LinkTelegramStartDto {
  @IsOptional()
  @IsString()
  bot_username?: string;
}
