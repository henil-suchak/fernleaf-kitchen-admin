import { IsString, Matches } from 'class-validator';

export class DispatchBoardQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDate!: string;
}
