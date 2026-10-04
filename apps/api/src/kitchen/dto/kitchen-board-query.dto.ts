import { IsOptional, IsString, IsUUID, Matches } from 'class-validator';

export class KitchenBoardQueryDto {
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/)
  deliveryDate!: string;
  @IsOptional() @IsUUID('4') stationId?: string;
}
