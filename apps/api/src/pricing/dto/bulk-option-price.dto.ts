import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsUUID,
  Max,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';

export class OptionPriceEntryDto {
  @IsUUID('4')
  optionId!: string;

  @ValidateIf((_object, value: unknown) => value !== null)
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(2_147_483_647)
  explicitPriceMinorUnits!: number | null;
}

export class BulkOptionPriceDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionPriceEntryDto)
  entries!: OptionPriceEntryDto[];
}
