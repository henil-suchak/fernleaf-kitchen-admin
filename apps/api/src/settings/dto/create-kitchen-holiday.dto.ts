import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, Matches, MaxLength } from 'class-validator';

const HOLIDAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateKitchenHolidayDto {
  @IsString()
  @Matches(HOLIDAY_DATE_PATTERN, {
    message: 'date must use the YYYY-MM-DD format.',
  })
  date!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name?: string;
}
