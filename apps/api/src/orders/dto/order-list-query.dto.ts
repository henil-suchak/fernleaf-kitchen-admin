import { Transform } from 'class-transformer';
import { IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { OrderStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class OrderListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) deliveryFrom?: string;
  @IsOptional() @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) deliveryTo?: string;
  @IsOptional() @IsEnum(OrderStatus) status?: OrderStatus;
  @IsOptional() @IsUUID('4') companyId?: string;
  @IsOptional() @Transform(({ value }: { value: unknown }) => typeof value === 'string' ? value.trim() : value)
  @IsString() @MaxLength(160) search?: string;
}
