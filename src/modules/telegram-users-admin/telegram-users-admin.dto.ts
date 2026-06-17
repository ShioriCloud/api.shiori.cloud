import { Transform } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
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
