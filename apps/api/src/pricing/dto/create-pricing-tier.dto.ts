import { Transform, Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';
import { PricingDerivationSource } from '@prisma/client';

import { normalizePricingName } from '../pricing-name.util';

export class CreatePricingTierDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizePricingName(value).name : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @IsOptional()
  @IsEnum(PricingDerivationSource)
  derivationSource?: PricingDerivationSource | null;

  @IsOptional()
  @IsUUID('4')
  baseTierId?: string | null;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(2_147_483_647)
  multiplierBps?: number | null;
}
