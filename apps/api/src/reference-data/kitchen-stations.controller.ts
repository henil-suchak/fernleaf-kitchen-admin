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
import { CreateReferenceValueDto } from './dto/create-reference-value.dto';
import { UpdateReferenceValueDto } from './dto/update-reference-value.dto';
import { ReferenceDataService } from './reference-data.service';
import type { ReferenceValueResponse } from './reference-data.types';

@Controller('reference-data/kitchen-stations')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class KitchenStationsController {
  constructor(private readonly referenceDataService: ReferenceDataService) {}

  @Get()
  @RequirePermissions(PermissionCode.CATALOGUE_READ)
  listKitchenStations(): Promise<ReferenceValueResponse[]> {
    return this.referenceDataService.listKitchenStations();
  }

  @Post()
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  createKitchenStation(
    @Body() input: CreateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    return this.referenceDataService.createKitchenStation(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  updateKitchenStation(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    return this.referenceDataService.updateKitchenStation(id, input);
  }
}
