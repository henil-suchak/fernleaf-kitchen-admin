import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

import { CUTOFF_TIME_PATTERN } from '../settings-time.util';
import { WEEKDAY_ORDER, type KitchenSettingsResponse } from '../settings.types';

export class UpdateKitchenSettingsDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  timezone?: string;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(WEEKDAY_ORDER, { each: true })
  workingDays?: KitchenSettingsResponse['workingDays'];

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  cutoffWorkingDays?: number;

  @IsOptional()
  @IsString()
  @Matches(CUTOFF_TIME_PATTERN, {
    message: 'cutoffTime must use the HH:mm format.',
  })
  cutoffTime?: string;
}
