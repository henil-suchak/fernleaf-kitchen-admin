import { IsArray, IsUUID } from 'class-validator';

export class ReplaceCompanyMenuHidingDto {
  @IsArray()
  @IsUUID('4', { each: true })
  categoryIds!: string[];

  @IsArray()
  @IsUUID('4', { each: true })
  menuItemIds!: string[];
}
