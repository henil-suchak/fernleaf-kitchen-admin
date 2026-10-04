import { Controller, Get, Param, ParseUUIDPipe, Post, Query, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { KitchenBoardQueryDto } from './dto/kitchen-board-query.dto';
import { KitchenService } from './kitchen.service';

@Controller('kitchen')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KitchenController {
  constructor(private readonly kitchenService: KitchenService) {}

  @Get('board') @RequirePermissions(PermissionCode.KITCHEN_READ)
  board(@Query() query: KitchenBoardQueryDto) { return this.kitchenService.board(query); }

  @Post('units/:combinationId/start') @RequirePermissions(PermissionCode.KITCHEN_UPDATE)
  start(@Param('combinationId', new ParseUUIDPipe({ version: '4' })) combinationId: string) { return this.kitchenService.start(combinationId); }

  @Post('units/:combinationId/complete') @RequirePermissions(PermissionCode.KITCHEN_UPDATE)
  complete(@Param('combinationId', new ParseUUIDPipe({ version: '4' })) combinationId: string) { return this.kitchenService.complete(combinationId); }

  @Post('orders/:orderId/force-complete') @RequirePermissions(PermissionCode.ORDER_OVERRIDE)
  forceComplete(@Param('orderId', new ParseUUIDPipe({ version: '4' })) orderId: string) { return this.kitchenService.forceComplete(orderId); }
}
