import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

const SORT_FIELDS = [
  'last_seen_at',
  'first_seen_at',
  'visit_count',
  'favorites_count',
  'first_name',
  'username',
  'app_role',
] as const;

export class ListTelegramUsersQueryDto {
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
  @IsString()
  roleFilter?: string;

  @IsOptional()
  @IsIn(['all', 'with', 'without'])
  usernameFilter?: 'all' | 'with' | 'without';

  /** Account status: banned vs not banned. */
  @IsOptional()
  @IsIn(['all', 'banned', 'active'])
  statusFilter?: 'all' | 'banned' | 'active';

  @IsOptional()
  @IsIn(SORT_FIELDS)
  sortBy?: (typeof SORT_FIELDS)[number];

  @IsOptional()
  @IsIn(['asc', 'desc'])
  sortDir?: 'asc' | 'desc';
}

export class UpdateTelegramUserAdminDto {
  @IsString()
  @IsIn(['user', 'moderator', 'admin'])
  app_role!: string;

  @IsOptional()
  @IsString()
  admin_notes?: string | null;

  @IsOptional()
  @IsString()
  username?: string | null;

  @IsOptional()
  @IsString()
  email?: string | null;

  @IsOptional()
  @IsString()
  password?: string | null;

  @IsOptional()
  @IsBoolean()
  portal_login_enabled?: boolean;
}

export class BanTelegramUserDto {
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string | null;
}

const AUDIT_ACTIONS = [
  'change_role',
  'ban',
  'unban',
  'revoke_sessions',
  'portal_password_set',
  'portal_login_toggle',
  'grant_tokens',
  'grant_subscription',
] as const;

export class ListAdminAuditEventsQueryDto {
  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '1'), 10))
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Transform(({ value }) => Number.parseInt(String(value ?? '40'), 10))
  @IsInt()
  @Min(1)
  @Max(100)
  limit?: number;

  @IsOptional()
  @IsIn(AUDIT_ACTIONS)
  action?: (typeof AUDIT_ACTIONS)[number];

  /** Match actor/target telegram id or username/name substring. */
  @IsOptional()
  @IsString()
  search?: string;

  /** ISO date/time — events at or after this instant (UTC). */
  @IsOptional()
  @IsString()
  since?: string;

  /** ISO date/time — events at or before this instant (UTC). */
  @IsOptional()
  @IsString()
  until?: string;
}
