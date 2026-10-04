import { Type } from 'class-transformer';
import { IsBoolean, IsInt, IsOptional, IsUUID, Min } from 'class-validator';

export class CreateMenuCategoryItemDto {
  @IsUUID('4')
  dishId!: string;

  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder!: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}

export class UpdateMenuCategoryItemDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  sortOrder?: number;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
