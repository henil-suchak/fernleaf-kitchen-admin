import { Type } from 'class-transformer';
import { ArrayNotEmpty, IsArray, IsString, IsUUID, Matches, ValidateNested } from 'class-validator';

import { OrderEditableContentDto, OrderLineDto } from './order-content.dto';

export class CreateOrderDto extends OrderEditableContentDto {
  @IsUUID('4') employeeId!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) deliveryDate!: string;
  @IsArray() @ArrayNotEmpty() @ValidateNested({ each: true }) @Type(() => OrderLineDto)
  declare lines: OrderLineDto[];
}
