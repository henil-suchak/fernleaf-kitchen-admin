import { IsString, Matches } from 'class-validator';

export class ProcessCutoffDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDate!: string;
}
