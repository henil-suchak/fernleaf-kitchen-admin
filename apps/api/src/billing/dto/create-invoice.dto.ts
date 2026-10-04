import { ArrayMinSize, ArrayUnique, IsArray, IsUUID } from 'class-validator';

export class CreateInvoiceDto {
  @IsUUID('4')
  companyId!: string;

  @IsArray()
  @ArrayMinSize(1)
  @ArrayUnique()
  @IsUUID('4', { each: true })
  orderIds!: string[];
}
