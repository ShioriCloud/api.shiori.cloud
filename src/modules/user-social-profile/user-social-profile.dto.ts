import { IsString, MaxLength } from 'class-validator';

export class UpdateSocialProfileDto {
  @IsString()
  @MaxLength(40)
  display_name!: string;
}
