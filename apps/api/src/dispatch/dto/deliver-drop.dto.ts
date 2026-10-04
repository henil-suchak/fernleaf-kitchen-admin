import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class DeliverDropDto {
  @IsOptional() @IsString() @MaxLength(1000) note?: string;
  @IsOptional() @IsUrl({ require_tld: false }) @MaxLength(2048) photoUrl?: string;
}
