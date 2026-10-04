import { IsEnum, IsOptional, IsUUID } from 'class-validator';
import { InvoiceStatus } from '@prisma/client';

import { PaginationQueryDto } from '../../common/pagination/pagination-query.dto';

export class InvoiceListQueryDto extends PaginationQueryDto {
  @IsOptional() @IsUUID('4') companyId?: string;
  @IsOptional() @IsEnum(InvoiceStatus) status?: InvoiceStatus;
}
