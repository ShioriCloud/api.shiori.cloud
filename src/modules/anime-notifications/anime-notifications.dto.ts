import { IsBoolean, IsOptional } from 'class-validator';

export class UpdateNotificationPreferencesDto {
  @IsOptional()
  @IsBoolean()
  notify_new_episode?: boolean;

  @IsOptional()
  @IsBoolean()
  notify_telegram_dm?: boolean;
}
