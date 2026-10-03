import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import type { DishDetailResponse, DishListItemResponse } from './catalogue.types';
import { DishService } from './dish.service';
import { CreateDishDto } from './dto/create-dish.dto';
import { DishListQueryDto } from './dto/dish-list-query.dto';
import { ReplaceDishOptionGroupsDto } from './dto/replace-dish-option-groups.dto';
import { UpdateDishDto } from './dto/update-dish.dto';

@Controller('catalogue/dishes')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class DishesController {
  constructor(private readonly dishService: DishService) {}

  @Get()
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  listDishes(
    @Query() query: DishListQueryDto,
  ): Promise<PaginatedResponse<DishListItemResponse>> {
    return this.dishService.listDishes(query);
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  getDish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<DishDetailResponse> {
    return this.dishService.getDish(id);
  }

  @Post()
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  createDish(@Body() input: CreateDishDto): Promise<DishDetailResponse> {
    return this.dishService.createDish(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  updateDish(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateDishDto,
  ): Promise<DishDetailResponse> {
    return this.dishService.updateDish(id, input);
  }

  @Put(':id/option-groups')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  replaceOptionGroups(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReplaceDishOptionGroupsDto,
  ): Promise<DishDetailResponse> {
    return this.dishService.replaceDishOptionGroups(id, input);
  }
}
