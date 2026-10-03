import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Put,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import type { CatalogueValueResponse, OptionGroupDetailResponse } from './catalogue.types';
import { CreateOptionGroupDto } from './dto/create-option-group.dto';
import { ReplaceOptionGroupOptionsDto } from './dto/replace-option-group-options.dto';
import { UpdateOptionGroupDto } from './dto/update-option-group.dto';
import { OptionGroupService } from './option-group.service';

@Controller('catalogue/option-groups')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OptionGroupsController {
  constructor(private readonly optionGroupService: OptionGroupService) {}

  @Get()
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  listOptionGroups(): Promise<CatalogueValueResponse[]> {
    return this.optionGroupService.listOptionGroups();
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  getOptionGroup(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<OptionGroupDetailResponse> {
    return this.optionGroupService.getOptionGroup(id);
  }

  @Post()
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  createOptionGroup(
    @Body() input: CreateOptionGroupDto,
  ): Promise<CatalogueValueResponse> {
    return this.optionGroupService.createOptionGroup(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  updateOptionGroup(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateOptionGroupDto,
  ): Promise<CatalogueValueResponse> {
    return this.optionGroupService.updateOptionGroup(id, input);
  }

  @Put(':id/options')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  replaceOptions(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: ReplaceOptionGroupOptionsDto,
  ): Promise<OptionGroupDetailResponse> {
    return this.optionGroupService.replaceOptionGroupOptions(id, input);
  }
}
