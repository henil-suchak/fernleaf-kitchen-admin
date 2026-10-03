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
import { CompanyAddressDto } from './company-address.dto';

export class CreateCompanyDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  name!: string;

  @Type(() => BillingContactDto)
  @ValidateNested()
  billingContact!: BillingContactDto;

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

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(40)
  defaultPackaging!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.trim() || undefined : value,
  )
  @IsString()
  @MaxLength(1000)
  driverInstructions?: string;

  @IsOptional()
  @IsUUID('4')
  pricingTierId?: string | null;

  @IsOptional()
  @IsUUID('4')
  defaultDriverId?: string | null;

  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  domains!: string[];

  @IsArray()
  @ArrayNotEmpty()
  @Type(() => CompanyAddressDto)
  @ValidateNested({ each: true })
  addresses!: CompanyAddressDto[];
}
