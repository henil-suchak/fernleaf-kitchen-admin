import { Transform } from 'class-transformer';
import { IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

function trimOptional(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() || undefined : value;
}

export class CompanyAddressDto {
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  label!: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(160)
  addressLine1!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @MaxLength(160)
  addressLine2?: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  city!: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  stateRegion!: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  postalCode!: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  country!: string;
}
