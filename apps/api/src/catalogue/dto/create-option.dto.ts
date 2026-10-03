import { Transform, Type } from 'class-transformer';
import {
  ArrayUnique,
  IsArray,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { normalizeDisplayName } from '../catalogue-name.util';

export class CreateOptionDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeDisplayName(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;

  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  costMinorUnits!: number;

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  allergenIds?: string[];

  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  dietaryTagIds?: string[];
}
