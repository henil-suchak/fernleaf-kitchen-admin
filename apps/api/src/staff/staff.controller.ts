import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { CreateStaffDto } from './dto/create-staff.dto';
import { UpdateStaffDto } from './dto/update-staff.dto';
import { StaffService } from './staff.service';

@Controller('staff')
@UseGuards(JwtAuthGuard, PermissionsGuard)
@RequirePermissions(PermissionCode.STAFF_MANAGE)
export class StaffController {
  constructor(private readonly staffService: StaffService) {}

  @Get()
  listStaff() {
    return this.staffService.listStaff();
  }

  @Get('roles')
  listRoles() {
    return this.staffService.listRoles();
  }

  @Post()
  createStaff(@Body() input: CreateStaffDto) {
    return this.staffService.createStaff(input);
  }

  @Patch(':id')
  updateStaff(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateStaffDto,
  ) {
    return this.staffService.updateStaff(id, input);
  }
}
