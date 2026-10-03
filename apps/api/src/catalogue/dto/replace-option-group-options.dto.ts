import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class OptionGroupOptionInputDto {
  @IsUUID('4')
  optionId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder!: number;
}

export class ReplaceOptionGroupOptionsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OptionGroupOptionInputDto)
  options!: OptionGroupOptionInputDto[];
}
