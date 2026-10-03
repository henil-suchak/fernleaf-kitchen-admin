import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  UseGuards,
} from '@nestjs/common';

import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RequirePermissions } from '../authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../authorization/guards/permissions.guard';
import { PermissionCode } from '../authorization/permission-code';
import type { CatalogueValueResponse } from './catalogue.types';
import { CreateOptionDto } from './dto/create-option.dto';
import { UpdateOptionDto } from './dto/update-option.dto';
import { OptionService } from './option.service';

@Controller('catalogue/options')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class OptionsController {
  constructor(private readonly optionService: OptionService) {}

  @Get()
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  listOptions(): Promise<CatalogueValueResponse[]> {
    return this.optionService.listOptions();
  }

  @Post()
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  createOption(@Body() input: CreateOptionDto): Promise<CatalogueValueResponse> {
    return this.optionService.createOption(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  updateOption(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateOptionDto,
  ): Promise<CatalogueValueResponse> {
    return this.optionService.updateOption(id, input);
  }
}
