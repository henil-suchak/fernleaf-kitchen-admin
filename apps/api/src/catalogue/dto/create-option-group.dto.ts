import { Transform } from 'class-transformer';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

import { normalizeDisplayName } from '../catalogue-name.util';

export class CreateOptionGroupDto {
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? normalizeDisplayName(value) : value,
  )
  @IsString()
  @IsNotEmpty()
  @MaxLength(80)
  name!: string;
}
