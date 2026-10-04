import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, Query, UseGuards } from '@nestjs/common';

import { CurrentStaff } from '../auth/decorators/current-staff.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import type { AuthenticatedStaff } from '../auth/types/authenticated-staff.type';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderListQueryDto } from './dto/order-list-query.dto';
import { ProcessCutoffDto } from './dto/process-cutoff.dto';
import { UpdateOrderDeliveryDto } from './dto/update-order-delivery.dto';
import { UpdateOrderDto } from './dto/update-order.dto';
import { OrdersService } from './orders.service';

@Controller('orders')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OrdersController {
  constructor(private readonly ordersService: OrdersService) {}

  @Post() @RequirePermissions(PermissionCode.ORDER_CREATE)
  create(@Body() input: CreateOrderDto, @CurrentStaff() staff: AuthenticatedStaff) { return this.ordersService.create(input, staff.id); }

  @Get() @RequirePermissions(PermissionCode.ORDER_READ)
  list(@Query() query: OrderListQueryDto) { return this.ordersService.list(query); }

  @Get(':id') @RequirePermissions(PermissionCode.ORDER_READ)
  get(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.ordersService.get(id); }

  @Put(':id') @RequirePermissions(PermissionCode.ORDER_EDIT)
  update(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: UpdateOrderDto) { return this.ordersService.update(id, input); }

  @Post(':id/place') @RequirePermissions(PermissionCode.ORDER_EDIT)
  place(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentStaff() staff: AuthenticatedStaff) { return this.ordersService.place(id, staff.id); }

  @Post(':id/cancel')
  cancel(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @CurrentStaff() staff: AuthenticatedStaff) { return this.ordersService.cancel(id, staff.id); }

  @Patch(':id/delivery') @RequirePermissions(PermissionCode.ORDER_OVERRIDE)
  updateDelivery(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: UpdateOrderDeliveryDto) { return this.ordersService.updateDelivery(id, input); }

  @Post('cutoff/process') @RequirePermissions(PermissionCode.ORDER_OVERRIDE)
  processCutoff(@Body() input: ProcessCutoffDto, @CurrentStaff() staff: AuthenticatedStaff) { return this.ordersService.processCutoff(input.deliveryDate, staff.id); }
}
