import { Transform, Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

import { CUTOFF_TIME_PATTERN } from '../../settings/settings-time.util';
import { WEEKDAY_ORDER } from '../../settings/settings.types';
import { BillingContactDto } from './billing-contact.dto';

export class UpdateCompanyDto {
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name?: string;

  @IsOptional()
  @Type(() => BillingContactDto)
  @ValidateNested()
  billingContact?: BillingContactDto;

  @IsOptional()
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(WEEKDAY_ORDER, { each: true })
  workingDays?: (typeof WEEKDAY_ORDER)[number][];

  @IsOptional()
  @IsString()
  @Matches(CUTOFF_TIME_PATTERN, {
    message: 'defaultDeliveryTime must use the HH:mm format.',
  })
  defaultDeliveryTime?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  deliveryMinutesBefore?: number;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  defaultPackaging?: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || null : value,
  )
  @IsString()
  @MaxLength(1000)
  driverInstructions?: string | null;

  @IsOptional()
  @IsUUID('4')
  pricingTierId?: string | null;

  @IsOptional()
  @IsUUID('4')
  defaultDriverId?: string | null;

  @IsOptional()
  @IsUUID('4')
  ownerEmployeeId?: string | null;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
