import { IsArray, IsBoolean, IsOptional, IsString } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  notify_new_episode?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_telegram_dm?: boolean;

  @IsOptional()
  @IsBoolean()
  hide_telegram_username?: boolean;
}

export class SyncAiringRemindersDto {
  @IsArray()
  @IsString({ each: true })
  anime_ids: string[];
}
