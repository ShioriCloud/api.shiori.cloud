import { Type } from 'class-transformer';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

export const SUPPORT_TICKET_CATEGORIES = [
  'bug_report',
  'app_improvement',
  'feature_request',
  'translation_request',
  'account_issue',
  'other',
] as const;

export const SUPPORT_TICKET_STATUSES = ['open', 'answered', 'closed'] as const;

export class CreateSupportTicketDto {
  @IsIn([...SUPPORT_TICKET_CATEGORIES])
  category!: (typeof SUPPORT_TICKET_CATEGORIES)[number];

  @IsString()
  @MinLength(3)
  @MaxLength(120)
  subject!: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  body!: string;
}

export class ReplySupportTicketDto {
  @IsString()
  @MinLength(1)
  @MaxLength(4000)
  body!: string;
}

export class UpdateSupportTicketStatusDto {
  @IsIn([...SUPPORT_TICKET_STATUSES])
  status!: (typeof SUPPORT_TICKET_STATUSES)[number];
}

export class ListSupportTicketsAdminQueryDto {
  @IsOptional()
  @IsIn([...SUPPORT_TICKET_STATUSES])
  status?: (typeof SUPPORT_TICKET_STATUSES)[number];

  @IsOptional()
  @IsIn([...SUPPORT_TICKET_CATEGORIES])
  category?: (typeof SUPPORT_TICKET_CATEGORIES)[number];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(10000)
  limit?: number;

  /** Subject, ticket id, telegram id, or user name/username substring. */
  @IsOptional()
  @IsString()
  @MaxLength(120)
  search?: string;
}
