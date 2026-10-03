import { ArrayNotEmpty, IsArray, IsString, MaxLength } from 'class-validator';

export class ReplaceCompanyDomainsDto {
  @IsArray()
  @ArrayNotEmpty()
  @IsString({ each: true })
  @MaxLength(253, { each: true })
  domains!: string[];
}
