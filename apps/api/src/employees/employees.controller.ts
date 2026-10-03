import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { CreateEmployeeDto } from './dto/create-employee.dto';
import { EmployeeListQueryDto } from './dto/employee-list-query.dto';
import { UpdateEmployeeDto } from './dto/update-employee.dto';
import { EmployeesService } from './employees.service';
import type { EmployeeResponse, EmployeeSummaryResponse } from './employee.types';

@Controller('employees')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class EmployeesController {
  constructor(private readonly employeesService: EmployeesService) {}

  @Get()
  @RequirePermissions(PermissionCode.EMPLOYEE_READ)
  listEmployees(@Query() query: EmployeeListQueryDto): Promise<PaginatedResponse<EmployeeSummaryResponse>> {
    return this.employeesService.listEmployees(query);
  }

  @Post()
  @RequirePermissions(PermissionCode.EMPLOYEE_WRITE)
  createEmployee(@Body() input: CreateEmployeeDto): Promise<EmployeeResponse> {
    return this.employeesService.createEmployee(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.EMPLOYEE_WRITE)
  updateEmployee(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateEmployeeDto,
  ): Promise<EmployeeResponse> {
    return this.employeesService.updateEmployee(id, input);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.EMPLOYEE_READ)
  getEmployee(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<EmployeeResponse> {
    return this.employeesService.getEmployee(id);
  }
}
