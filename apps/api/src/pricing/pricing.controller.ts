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
import { BulkDishPriceDto } from './dto/bulk-dish-price.dto';
import { BulkOptionPriceDto } from './dto/bulk-option-price.dto';
import { CreatePricingTierDto } from './dto/create-pricing-tier.dto';
import { UpdatePricingTierDto } from './dto/update-pricing-tier.dto';
import { PricingService } from './pricing.service';
import type {
  BulkPriceUpdateResponse,
  PricingMatrixResponse,
  PricingTierResponse,
} from './pricing.types';

@Controller('pricing/tiers')
@UseGuards(JwtAuthGuard, PermissionsGuard)
export class PricingController {
  constructor(private readonly pricingService: PricingService) {}

  @Get()
  @RequirePermissions(PermissionCode.PRICING_READ)
  listPricingTiers(): Promise<PricingTierResponse[]> {
    return this.pricingService.listPricingTiers();
  }

  @Get(':id')
  @RequirePermissions(PermissionCode.PRICING_READ)
  getPricingTier(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PricingTierResponse> {
    return this.pricingService.getPricingTier(id);
  }

  @Post()
  @RequirePermissions(PermissionCode.PRICING_WRITE)
  createPricingTier(
    @Body() input: CreatePricingTierDto,
  ): Promise<PricingTierResponse> {
    return this.pricingService.createPricingTier(input);
  }

  @Patch(':id')
  @RequirePermissions(PermissionCode.PRICING_WRITE)
  updatePricingTier(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: UpdatePricingTierDto,
  ): Promise<PricingTierResponse> {
    return this.pricingService.updatePricingTier(id, input);
  }

  @Put(':id/dish-prices')
  @RequirePermissions(PermissionCode.PRICING_WRITE)
  replaceDishPrices(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: BulkDishPriceDto,
  ): Promise<BulkPriceUpdateResponse> {
    return this.pricingService.replaceDishPrices(id, input);
  }

  @Put(':id/option-prices')
  @RequirePermissions(PermissionCode.PRICING_WRITE)
  replaceOptionPrices(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
    @Body() input: BulkOptionPriceDto,
  ): Promise<BulkPriceUpdateResponse> {
    return this.pricingService.replaceOptionPrices(id, input);
  }

  @Get(':id/matrix')
  @RequirePermissions(PermissionCode.PRICING_READ)
  getPricingMatrix(
    @Param('id', new ParseUUIDPipe({ version: '4' })) id: string,
  ): Promise<PricingMatrixResponse> {
    return this.pricingService.getPricingMatrix(id);
  }
}
