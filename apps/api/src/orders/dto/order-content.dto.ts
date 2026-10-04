import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsInt, IsOptional, IsString, IsUUID, Matches, MaxLength, Min, ValidateNested } from 'class-validator';

import { CUTOFF_TIME_PATTERN } from '../../settings/settings-time.util';

export class OrderSelectionDto {
  @IsUUID('4') optionGroupId!: string;
  @IsUUID('4') optionId!: string;
}

export class OrderCombinationDto {
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsArray() @ValidateNested({ each: true }) @Type(() => OrderSelectionDto)
  selections!: OrderSelectionDto[];
}

export class OrderLineDto {
  @IsUUID('4') dishId!: string;
  @Type(() => Number) @IsInt() @Min(1) quantity!: number;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OrderCombinationDto)
  combinations!: OrderCombinationDto[];
}

export class OrderEditableContentDto {
  @IsOptional() @IsUUID('4') deliveryAddressId?: string;
  @IsOptional() @IsString() @MaxLength(5) @Matches(CUTOFF_TIME_PATTERN, { message: 'deliveryTime must use the HH:mm format.' }) deliveryTime?: string;
  @IsOptional() @IsString() @MaxLength(40) packaging?: string;
  @IsOptional() @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  lines?: OrderLineDto[];
}

export { CUTOFF_TIME_PATTERN };
