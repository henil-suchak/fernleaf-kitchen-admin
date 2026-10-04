import { Controller, Get, UseGuards } from '@nestjs/common';

import { CurrentStaff } from '../auth/decorators/current-staff.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedStaff } from '../auth/types/authenticated-staff.type';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { DashboardService } from './dashboard.service';

@Controller('dashboard')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DashboardController {
  constructor(private readonly dashboardService: DashboardService) {}

  @Get('admin')
  @RequirePermissions(PermissionCode.ORDER_READ, PermissionCode.KITCHEN_READ, PermissionCode.DISPATCH_READ, PermissionCode.BILLING_READ)
  admin() { return this.dashboardService.admin(); }

  @Get('kitchen')
  @RequirePermissions(PermissionCode.KITCHEN_READ)
  kitchen() { return this.dashboardService.kitchen(); }

  @Get('dispatch')
  @RequirePermissions(PermissionCode.DISPATCH_READ)
  dispatch() { return this.dashboardService.dispatch(); }

  @Get('driver')
  @RequirePermissions(PermissionCode.DELIVERY_OWN_READ)
  driver(@CurrentStaff() staff: AuthenticatedStaff) { return this.dashboardService.driver(staff.id); }
}
