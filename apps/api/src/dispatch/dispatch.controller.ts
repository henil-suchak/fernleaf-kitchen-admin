import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query, UseGuards } from '@nestjs/common';

import { CurrentStaff } from '../auth/decorators/current-staff.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedStaff } from '../auth/types/authenticated-staff.type';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { AssignDriverDto } from './dto/assign-driver.dto';
import { DeliverDropDto } from './dto/deliver-drop.dto';
import { DispatchBoardQueryDto } from './dto/dispatch-board-query.dto';
import { DispatchService } from './dispatch.service';

@Controller('dispatch') @UseGuards(JwtAuthGuard, PermissionsGuard)
export class DispatchController {
  constructor(private readonly dispatchService: DispatchService) {}
  @Get('board') @RequirePermissions(PermissionCode.DISPATCH_READ)
  board(@Query() query: DispatchBoardQueryDto) { return this.dispatchService.board(query.deliveryDate); }
  @Patch('drops/:id/driver') @RequirePermissions(PermissionCode.DISPATCH_UPDATE)
  assign(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: AssignDriverDto) { return this.dispatchService.assignDriver(id, input.driverId); }
  @Post('drops/:id/dispatch-ready') @RequirePermissions(PermissionCode.DISPATCH_UPDATE)
  ready(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.dispatchService.dispatchReady(id); }
  @Post('drops/:id/out-for-delivery') @RequirePermissions(PermissionCode.DISPATCH_UPDATE)
  out(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.dispatchService.outForDelivery(id); }
}

@Controller('driver/drops') @UseGuards(JwtAuthGuard, PermissionsGuard)
export class DriverDropsController {
  constructor(private readonly dispatchService: DispatchService) {}
  @Get('today') @RequirePermissions(PermissionCode.DELIVERY_OWN_READ)
  today(@CurrentStaff() staff: AuthenticatedStaff) { return this.dispatchService.driverToday(staff.id); }
  @Post(':id/deliver') @RequirePermissions(PermissionCode.DELIVERY_OWN_UPDATE)
  deliver(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: DeliverDropDto, @CurrentStaff() staff: AuthenticatedStaff) { return this.dispatchService.deliver(id, staff.id, input); }
}
