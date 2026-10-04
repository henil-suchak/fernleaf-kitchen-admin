import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Put, UseGuards } from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { CreateMenuCategoryItemDto, UpdateMenuCategoryItemDto } from './dto/menu-category-item.dto';
import { CreateMenuCategoryDto, UpdateMenuCategoryDto } from './dto/menu-category.dto';
import { ReplaceCompanyMenuHidingDto } from './dto/replace-company-menu-hiding.dto';
import { MenuService } from './menu.service';

@Controller('menu')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class MenuController {
  constructor(private readonly menuService: MenuService) {}

  @Get('categories') @RequirePermissions(PermissionCode.MENU_READ)
  listCategories() { return this.menuService.listCategories(); }

  @Get('categories/:id') @RequirePermissions(PermissionCode.MENU_READ)
  getCategory(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string) { return this.menuService.getCategory(id); }

  @Post('categories') @RequirePermissions(PermissionCode.MENU_WRITE)
  createCategory(@Body() input: CreateMenuCategoryDto) { return this.menuService.createCategory(input); }

  @Patch('categories/:id') @RequirePermissions(PermissionCode.MENU_WRITE)
  updateCategory(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: UpdateMenuCategoryDto) { return this.menuService.updateCategory(id, input); }

  @Post('categories/:id/items') @RequirePermissions(PermissionCode.MENU_WRITE)
  createItem(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: CreateMenuCategoryItemDto) { return this.menuService.createItem(id, input); }

  @Patch('categories/:categoryId/items/:itemId') @RequirePermissions(PermissionCode.MENU_WRITE)
  updateItem(@Param('categoryId', new ParseUUIDPipe({ version: '4' })) categoryId: string, @Param('itemId', new ParseUUIDPipe({ version: '4' })) itemId: string, @Body() input: UpdateMenuCategoryItemDto) { return this.menuService.updateItem(categoryId, itemId, input); }

  @Get('preview/employees/:employeeId') @RequirePermissions(PermissionCode.MENU_READ)
  previewEmployee(@Param('employeeId', new ParseUUIDPipe({ version: '4' })) employeeId: string) { return this.menuService.previewEmployeeMenu(employeeId); }

  @Get('preview/employees/:employeeId/categories/:categoryId') @RequirePermissions(PermissionCode.MENU_READ)
  previewEmployeeCategory(@Param('employeeId', new ParseUUIDPipe({ version: '4' })) employeeId: string, @Param('categoryId', new ParseUUIDPipe({ version: '4' })) categoryId: string) { return this.menuService.previewEmployeeCategory(employeeId, categoryId); }
}

@Controller('companies')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class CompanyMenuController {
  constructor(private readonly menuService: MenuService) {}

  @Put(':id/menu-hiding') @RequirePermissions(PermissionCode.MENU_WRITE)
  replaceMenuHiding(@Param('id', new ParseUUIDPipe({ version: '4' })) id: string, @Body() input: ReplaceCompanyMenuHidingDto) { return this.menuService.replaceCompanyHiding(id, input); }
}
