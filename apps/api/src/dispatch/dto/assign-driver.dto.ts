import { IsUUID } from 'class-validator';

export class AssignDriverDto { @IsUUID('4') driverId!: string; }
