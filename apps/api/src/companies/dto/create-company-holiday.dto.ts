import { Transform } from 'class-transformer';
import { IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HOLIDAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateCompanyHolidayDto {
  @IsString()
  @Matches(HOLIDAY_DATE_PATTERN, {
    message: 'date must use the YYYY-MM-DD format.',
  })
  date!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(120)
  name?: string;
}
