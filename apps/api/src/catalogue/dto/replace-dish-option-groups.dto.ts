import { Type } from 'class-transformer';
import { IsArray, IsBoolean, IsInt, IsUUID, Min, ValidateNested } from 'class-validator';

export class DishOptionGroupInputDto {
  @IsUUID('4')
  optionGroupId!: string;

  @IsBoolean()
  isRequired!: boolean;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder!: number;
}

export class ReplaceDishOptionGroupsDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => DishOptionGroupInputDto)
  groups!: DishOptionGroupInputDto[];
}
