import { IsBoolean, IsOptional, IsUUID } from 'class-validator';

export class UpdateStaffDto {
  @IsOptional()
  @IsUUID('4')
  roleId?: string;

  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
