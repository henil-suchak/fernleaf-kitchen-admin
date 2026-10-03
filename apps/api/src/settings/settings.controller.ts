import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import { PaginationQueryDto } from '../common/pagination/pagination-query.dto';
import { CreateKitchenHolidayDto } from './dto/create-kitchen-holiday.dto';
import { UpdateKitchenSettingsDto } from './dto/update-kitchen-settings.dto';
import { SettingsService } from './settings.service';
import type {
  KitchenHolidayResponse,
  KitchenSettingsResponse,
} from './settings.types';

@Controller('settings/kitchen')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class SettingsController {
  constructor(private readonly settingsService: SettingsService) {}

  @Get()
  @RequirePermissions(PermissionCode.SETTINGS_READ)
  getKitchenSettings(): Promise<KitchenSettingsResponse> {
    return this.settingsService.getKitchenSettings();
  }

  @Patch()
  @RequirePermissions(PermissionCode.SETTINGS_WRITE)
  updateKitchenSettings(
    @Body() update: UpdateKitchenSettingsDto,
  ): Promise<KitchenSettingsResponse> {
    return this.settingsService.updateKitchenSettings(update);
  }

  @Get('holidays')
  @RequirePermissions(PermissionCode.SETTINGS_READ)
  listKitchenHolidays(
    @Query() pagination: PaginationQueryDto,
  ): Promise<PaginatedResponse<KitchenHolidayResponse>> {
    return this.settingsService.listKitchenHolidays(pagination);
  }

  @Post('holidays')
  @RequirePermissions(PermissionCode.SETTINGS_WRITE)
  addKitchenHoliday(
    @Body() input: CreateKitchenHolidayDto,
  ): Promise<KitchenHolidayResponse> {
    return this.settingsService.addKitchenHoliday(input);
  }

  @Delete('holidays/:id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @RequirePermissions(PermissionCode.SETTINGS_WRITE)
  async removeKitchenHoliday(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<void> {
    await this.settingsService.removeKitchenHoliday(id);
  }
}
