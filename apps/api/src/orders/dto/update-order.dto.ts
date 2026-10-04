import { IsOptional, IsString, Matches } from 'class-validator';

import { OrderEditableContentDto } from './order-content.dto';

export class UpdateOrderDto extends OrderEditableContentDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDate?: string;
}
