import { Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../prisma/prisma.service';
import { resolvePriceFromValues } from './pricing-resolution.util';
import type { PriceResolution } from './pricing.types';

@Injectable()
export class PricingResolver {
  constructor(private readonly prisma: PrismaService) {}

  async resolveDishPrice(
    dishId: string,
    pricingTierId: string,
  ): Promise<PriceResolution> {
    const dish = await this.prisma.dish.findUnique({
      where: { id: dishId },
      select: { id: true, isActive: true, costMinorUnits: true },
    });
    const tier = await this.prisma.pricingTier.findUnique({
      where: { id: pricingTierId },
      select: {
        id: true,
        isActive: true,
        derivationSource: true,
        baseTierId: true,
        multiplierBps: true,
        baseTier: { select: { isActive: true, derivationSource: true } },
      },
    });
    if (!dish) throw new NotFoundException('Dish not found.');
    if (!tier) throw new NotFoundException('Pricing tier not found.');

    const explicit = await this.prisma.dishTierPrice.findUnique({
      where: { pricingTierId_dishId: { pricingTierId, dishId } },
      select: { explicitPriceMinorUnits: true },
    });
    const baseExplicit =
      tier.baseTierId &&
      tier.baseTier?.isActive &&
      tier.baseTier.derivationSource === null
        ? await this.prisma.dishTierPrice.findUnique({
            where: {
              pricingTierId_dishId: {
                pricingTierId: tier.baseTierId,
                dishId,
              },
            },
            select: { explicitPriceMinorUnits: true },
          })
        : null;

    return resolvePriceFromValues(
      dish,
      tier,
      explicit?.explicitPriceMinorUnits ?? null,
      baseExplicit?.explicitPriceMinorUnits ?? null,
    );
  }

  async resolveOptionPrice(
    optionId: string,
    pricingTierId: string,
  ): Promise<PriceResolution> {
    const option = await this.prisma.option.findUnique({
      where: { id: optionId },
      select: { id: true, isActive: true, costMinorUnits: true },
    });
    const tier = await this.prisma.pricingTier.findUnique({
      where: { id: pricingTierId },
      select: {
        id: true,
        isActive: true,
        derivationSource: true,
        baseTierId: true,
        multiplierBps: true,
        baseTier: { select: { isActive: true, derivationSource: true } },
      },
    });
    if (!option) throw new NotFoundException('Option not found.');
    if (!tier) throw new NotFoundException('Pricing tier not found.');

    const explicit = await this.prisma.optionTierPrice.findUnique({
      where: { pricingTierId_optionId: { pricingTierId, optionId } },
      select: { explicitPriceMinorUnits: true },
    });
    const baseExplicit =
      tier.baseTierId &&
      tier.baseTier?.isActive &&
      tier.baseTier.derivationSource === null
        ? await this.prisma.optionTierPrice.findUnique({
            where: {
              pricingTierId_optionId: {
                pricingTierId: tier.baseTierId,
                optionId,
              },
            },
            select: { explicitPriceMinorUnits: true },
          })
        : null;

    return resolvePriceFromValues(
      option,
      tier,
      explicit?.explicitPriceMinorUnits ?? null,
      baseExplicit?.explicitPriceMinorUnits ?? null,
    );
  }
}
