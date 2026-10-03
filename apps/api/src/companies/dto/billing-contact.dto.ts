import { Transform } from 'class-transformer';
import { IsEmail, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';

function trimOptional(value: unknown): unknown {
  return typeof value === 'string' ? value.trim() || undefined : value;
}

export class BillingContactDto {
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @IsNotEmpty()
  @MaxLength(120)
  name!: string;

  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsEmail()
  @MaxLength(320)
  email!: string;

  @IsOptional()
  @Transform(({ value }: { value: unknown }) => trimOptional(value))
  @IsString()
  @MaxLength(32)
  phone?: string;
}
