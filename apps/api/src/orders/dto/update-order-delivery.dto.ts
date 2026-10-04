import { IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';

import { CUTOFF_TIME_PATTERN } from '../../settings/settings-time.util';

export class UpdateOrderDeliveryDto {
  @IsOptional() @IsUUID('4') deliveryAddressId?: string;
  @IsOptional() @IsString() @Matches(CUTOFF_TIME_PATTERN, { message: 'deliveryTime must use the HH:mm format.' }) deliveryTime?: string;
  @IsOptional() @IsString() @MaxLength(40) packaging?: string;
}
