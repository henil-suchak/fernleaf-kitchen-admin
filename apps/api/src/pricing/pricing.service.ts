import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  PricingDerivationSource,
  type PricingTier,
} from '@prisma/client';

import {
  assertMultiplierBps,
  assertSupportedPersistedMinorUnits,
} from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import type { BulkDishPriceDto, DishPriceEntryDto } from './dto/bulk-dish-price.dto';
import type {
  BulkOptionPriceDto,
  OptionPriceEntryDto,
} from './dto/bulk-option-price.dto';
import type { CreatePricingTierDto } from './dto/create-pricing-tier.dto';
import type { UpdatePricingTierDto } from './dto/update-pricing-tier.dto';
import {
  mapPricingPrismaError,
  pricingBusinessRuleError,
  pricingValidationError,
} from './pricing-errors.util';
import { normalizePricingName } from './pricing-name.util';
import { resolvePriceFromValues } from './pricing-resolution.util';
import type {
  BulkPriceUpdateResponse,
  PricingDishMatrixItem,
  PricingMatrixItem,
  PricingMatrixResponse,
  PricingTierResponse,
} from './pricing.types';

interface TierConfiguration {
  derivationSource: PricingDerivationSource | null;
  baseTierId: string | null;
  multiplierBps: number | null;
}

@Injectable()
export class PricingService {
  constructor(private readonly prisma: PrismaService) {}

  async listPricingTiers(): Promise<PricingTierResponse[]> {
    const tiers = await this.prisma.pricingTier.findMany({
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }, { id: 'asc' }],
    });
    return tiers.map(toPricingTierResponse);
  }

  async getPricingTier(id: string): Promise<PricingTierResponse> {
    const tier = await this.prisma.pricingTier.findUnique({ where: { id } });
    if (!tier) throw new NotFoundException('Pricing tier not found.');

    return toPricingTierResponse(tier);
  }

  async createPricingTier(
    input: CreatePricingTierDto,
  ): Promise<PricingTierResponse> {
    const tier = await this.prisma
      .$transaction(
        async (transaction) => {
          const existingCount = await transaction.pricingTier.count();
          const configuration = toCreateConfiguration(input);
          const isActive = input.isActive ?? true;
          const isDefault = input.isDefault ?? false;

          if (existingCount === 0 && (!isDefault || !isActive || configuration.derivationSource !== null)) {
            throw pricingBusinessRuleError(
              'pricingTier',
              'The first pricing tier must be active, manually priced, and the default tier.',
            );
          }

          await validateTierConfiguration(transaction, configuration, null);
          assertDefaultTierConfiguration(isDefault, isActive, configuration);

          if (isDefault && existingCount > 0) {
            await transaction.pricingTier.updateMany({
              where: { isDefault: true },
              data: { isDefault: false },
            });
          }

          return transaction.pricingTier.create({
            data: {
              ...normalizePricingName(input.name),
              isDefault,
              isActive,
              ...configuration,
            },
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        throw mapPricingPrismaError(
          error,
          'Pricing tier name already exists or a default-tier change conflicted.',
          'Pricing tier not found.',
        );
      });

    return toPricingTierResponse(tier);
  }

  async updatePricingTier(
    id: string,
    input: UpdatePricingTierDto,
  ): Promise<PricingTierResponse> {
    const tier = await this.prisma
      .$transaction(
        async (transaction) => {
          if (!hasTierUpdate(input)) {
            throw pricingValidationError(
              'pricingTier',
              'At least one pricing tier field must be provided.',
            );
          }

          const current = await transaction.pricingTier.findUnique({ where: { id } });
          if (!current) throw new NotFoundException('Pricing tier not found.');

          const configuration = mergeTierConfiguration(current, input);
          const isActive = input.isActive ?? current.isActive;
          const isDefault = input.isDefault ?? current.isDefault;

          if (current.isDefault && input.isDefault === false) {
            throw pricingBusinessRuleError(
              'isDefault',
              'The current default tier must be replaced, not simply unset.',
            );
          }

          await validateTierConfiguration(transaction, configuration, id);
          assertDefaultTierConfiguration(isDefault, isActive, configuration);

          const activeDependent = await transaction.pricingTier.findFirst({
            where: { baseTierId: id, isActive: true },
            select: { id: true },
          });
          if (!isActive && current.isActive && activeDependent) {
            throw pricingBusinessRuleError(
              'isActive',
              'A tier with active derived-tier dependants cannot be deactivated.',
            );
          }
          if (
            current.derivationSource === null &&
            configuration.derivationSource !== null &&
            activeDependent
          ) {
            throw pricingBusinessRuleError(
              'derivationSource',
              'A manually priced tier with active derived-tier dependants cannot become derived.',
            );
          }

          if (isDefault && !current.isDefault) {
            await transaction.pricingTier.updateMany({
              where: { isDefault: true },
              data: { isDefault: false },
            });
          }

          const data: Prisma.PricingTierUncheckedUpdateInput = {
            isDefault,
            isActive,
            ...configuration,
          };
          if (input.name !== undefined) {
            Object.assign(data, normalizePricingName(input.name));
          }

          return transaction.pricingTier.update({ where: { id }, data });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        throw mapPricingPrismaError(
          error,
          'Pricing tier name already exists or a default-tier change conflicted.',
          'Pricing tier not found.',
        );
      });

    return toPricingTierResponse(tier);
  }

  async replaceDishPrices(
    pricingTierId: string,
    input: BulkDishPriceDto,
  ): Promise<BulkPriceUpdateResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await requirePricingTier(transaction, pricingTierId);
      assertUniqueEntries(input.entries, 'entries', (entry) => entry.dishId);
      await validateDishes(transaction, input.entries);

      let updated = 0;
      let removed = 0;
      for (const entry of input.entries) {
        if (entry.explicitPriceMinorUnits === null) {
          const result = await transaction.dishTierPrice.deleteMany({
            where: { pricingTierId, dishId: entry.dishId },
          });
          removed += result.count;
        } else {
          validateExplicitPrice(entry.explicitPriceMinorUnits);
          await transaction.dishTierPrice.upsert({
            where: {
              pricingTierId_dishId: { pricingTierId, dishId: entry.dishId },
            },
            update: { explicitPriceMinorUnits: entry.explicitPriceMinorUnits },
            create: {
              pricingTierId,
              dishId: entry.dishId,
              explicitPriceMinorUnits: entry.explicitPriceMinorUnits,
            },
          });
          updated += 1;
        }
      }

      return { updated, removed };
    });
  }

  async replaceOptionPrices(
    pricingTierId: string,
    input: BulkOptionPriceDto,
  ): Promise<BulkPriceUpdateResponse> {
    return this.prisma.$transaction(async (transaction) => {
      await requirePricingTier(transaction, pricingTierId);
      assertUniqueEntries(input.entries, 'entries', (entry) => entry.optionId);
      await validateOptions(transaction, input.entries);

      let updated = 0;
      let removed = 0;
      for (const entry of input.entries) {
        if (entry.explicitPriceMinorUnits === null) {
          const result = await transaction.optionTierPrice.deleteMany({
            where: { pricingTierId, optionId: entry.optionId },
          });
          removed += result.count;
        } else {
          validateExplicitPrice(entry.explicitPriceMinorUnits);
          await transaction.optionTierPrice.upsert({
            where: {
              pricingTierId_optionId: { pricingTierId, optionId: entry.optionId },
            },
            update: { explicitPriceMinorUnits: entry.explicitPriceMinorUnits },
            create: {
              pricingTierId,
              optionId: entry.optionId,
              explicitPriceMinorUnits: entry.explicitPriceMinorUnits,
            },
          });
          updated += 1;
        }
      }

      return { updated, removed };
    });
  }

  async getPricingMatrix(id: string): Promise<PricingMatrixResponse> {
    const tier = await this.prisma.pricingTier.findUnique({
      where: { id },
      include: { baseTier: true },
    });
    if (!tier) throw new NotFoundException('Pricing tier not found.');

    const [dishes, options, dishPrices, optionPrices, baseDishPrices, baseOptionPrices] =
      await this.prisma.$transaction([
        this.prisma.dish.findMany({
          where: { isActive: true },
          select: { id: true, name: true, sku: true, costMinorUnits: true, isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.option.findMany({
          where: { isActive: true },
          select: { id: true, name: true, costMinorUnits: true, isActive: true },
          orderBy: [{ name: 'asc' }, { id: 'asc' }],
        }),
        this.prisma.dishTierPrice.findMany({
          where: { pricingTierId: id },
          select: { dishId: true, explicitPriceMinorUnits: true },
        }),
        this.prisma.optionTierPrice.findMany({
          where: { pricingTierId: id },
          select: { optionId: true, explicitPriceMinorUnits: true },
        }),
        tier.baseTierId
          ? this.prisma.dishTierPrice.findMany({
              where: { pricingTierId: tier.baseTierId },
              select: { dishId: true, explicitPriceMinorUnits: true },
            })
          : this.prisma.dishTierPrice.findMany({
              where: { pricingTierId: { in: [] } },
              select: { dishId: true, explicitPriceMinorUnits: true },
            }),
        tier.baseTierId
          ? this.prisma.optionTierPrice.findMany({
              where: { pricingTierId: tier.baseTierId },
              select: { optionId: true, explicitPriceMinorUnits: true },
            })
          : this.prisma.optionTierPrice.findMany({
              where: { pricingTierId: { in: [] } },
              select: { optionId: true, explicitPriceMinorUnits: true },
            }),
      ]);

    const dishPriceById = new Map(
      dishPrices.map((price) => [price.dishId, price.explicitPriceMinorUnits]),
    );
    const optionPriceById = new Map(
      optionPrices.map((price) => [price.optionId, price.explicitPriceMinorUnits]),
    );
    const baseDishPriceById = new Map(
      baseDishPrices.map((price) => [price.dishId, price.explicitPriceMinorUnits]),
    );
    const baseOptionPriceById = new Map(
      baseOptionPrices.map((price) => [price.optionId, price.explicitPriceMinorUnits]),
    );

    const tierForResolution = {
      isActive: tier.isActive,
      derivationSource:
        tier.baseTier && (!tier.baseTier.isActive || tier.baseTier.derivationSource !== null)
          ? null
          : tier.derivationSource,
      multiplierBps: tier.multiplierBps,
    } as const;

    return {
      tier: toPricingTierResponse(tier),
      dishes: dishes.map((dish): PricingDishMatrixItem => {
        const explicitPriceMinorUnits = dishPriceById.get(dish.id) ?? null;
        return {
          ...dish,
          explicitPriceMinorUnits,
          ...resolvePriceFromValues(
            dish,
            tierForResolution,
            explicitPriceMinorUnits,
            baseDishPriceById.get(dish.id) ?? null,
          ),
        };
      }),
      options: options.map((option): PricingMatrixItem => {
        const explicitPriceMinorUnits = optionPriceById.get(option.id) ?? null;
        return {
          ...option,
          explicitPriceMinorUnits,
          ...resolvePriceFromValues(
            option,
            tierForResolution,
            explicitPriceMinorUnits,
            baseOptionPriceById.get(option.id) ?? null,
          ),
        };
      }),
    };
  }
}

function toCreateConfiguration(input: CreatePricingTierDto): TierConfiguration {
  return {
    derivationSource: input.derivationSource ?? null,
    baseTierId: input.baseTierId ?? null,
    multiplierBps: input.multiplierBps ?? null,
  };
}

function mergeTierConfiguration(
  current: PricingTier,
  input: UpdatePricingTierDto,
): TierConfiguration {
  return {
    derivationSource:
      input.derivationSource === undefined
        ? current.derivationSource
        : input.derivationSource,
    baseTierId:
      input.baseTierId === undefined ? current.baseTierId : input.baseTierId,
    multiplierBps:
      input.multiplierBps === undefined
        ? current.multiplierBps
        : input.multiplierBps,
  };
}

async function validateTierConfiguration(
  transaction: Prisma.TransactionClient,
  configuration: TierConfiguration,
  tierId: string | null,
): Promise<void> {
  if (configuration.derivationSource === null) {
    if (
      configuration.derivationSource !== null ||
      configuration.baseTierId !== null ||
      configuration.multiplierBps !== null
    ) {
      throw pricingValidationError(
        'derivationSource',
        'Manually priced tiers must not have derivation configuration.',
      );
    }
    return;
  }

  if (configuration.multiplierBps === null) {
    throw pricingValidationError(
      'derivationSource',
      'Derived tiers require a multiplierBps.',
    );
  }
  try {
    assertMultiplierBps(configuration.multiplierBps);
  } catch {
    throw pricingValidationError(
      'multiplierBps',
      'multiplierBps must be a positive supported integer.',
    );
  }

  if (configuration.derivationSource === 'ITEM_COST') {
    if (configuration.baseTierId !== null) {
      throw pricingValidationError(
        'baseTierId',
        'ITEM_COST tiers must not have a baseTierId.',
      );
    }
    return;
  }

  if (configuration.baseTierId === null) {
    throw pricingValidationError(
      'baseTierId',
      'BASE_TIER derivation requires a baseTierId.',
    );
  }
  if (configuration.baseTierId === tierId) {
    throw pricingBusinessRuleError(
      'baseTierId',
      'A pricing tier cannot derive from itself.',
    );
  }

  const baseTier = await transaction.pricingTier.findUnique({
    where: { id: configuration.baseTierId },
    select: { isActive: true, derivationSource: true },
  });
  if (!baseTier) throw new NotFoundException('Base pricing tier not found.');
  if (!baseTier.isActive) {
    throw pricingBusinessRuleError(
      'baseTierId',
      'A derived tier requires an active base tier.',
    );
  }
  if (baseTier.derivationSource !== null) {
    throw pricingBusinessRuleError(
      'baseTierId',
      'A derived tier may only use a manually priced base tier.',
    );
  }
}

function assertDefaultTierConfiguration(
  isDefault: boolean,
  isActive: boolean,
  configuration: TierConfiguration,
): void {
  if (isDefault && (!isActive || configuration.derivationSource !== null)) {
    throw pricingBusinessRuleError(
      'isDefault',
      'The default pricing tier must be active and manually priced.',
    );
  }
}

function hasTierUpdate(input: UpdatePricingTierDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

async function requirePricingTier(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  const tier = await transaction.pricingTier.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!tier) throw new NotFoundException('Pricing tier not found.');
}

async function validateDishes(
  transaction: Prisma.TransactionClient,
  entries: DishPriceEntryDto[],
): Promise<void> {
  if (entries.length === 0) return;
  const dishes = await transaction.dish.findMany({
    where: { id: { in: entries.map((entry) => entry.dishId) } },
    select: { id: true },
  });
  if (dishes.length !== entries.length) throw new NotFoundException('Dish not found.');
}

async function validateOptions(
  transaction: Prisma.TransactionClient,
  entries: OptionPriceEntryDto[],
): Promise<void> {
  if (entries.length === 0) return;
  const options = await transaction.option.findMany({
    where: { id: { in: entries.map((entry) => entry.optionId) } },
    select: { id: true },
  });
  if (options.length !== entries.length) throw new NotFoundException('Option not found.');
}

function assertUniqueEntries<T>(
  entries: T[],
  field: string,
  getId: (entry: T) => string,
): void {
  const ids = entries.map(getId);
  if (new Set(ids).size !== ids.length) {
    throw pricingValidationError(field, `${field} must not contain duplicate items.`);
  }
}

function validateExplicitPrice(value: number): void {
  try {
    assertSupportedPersistedMinorUnits(value, 'explicitPriceMinorUnits');
  } catch {
    throw pricingValidationError(
      'explicitPriceMinorUnits',
      'explicitPriceMinorUnits must be a non-negative supported integer minor-unit amount.',
    );
  }
}

function toPricingTierResponse(tier: PricingTier): PricingTierResponse {
  return {
    id: tier.id,
    name: tier.name,
    isDefault: tier.isDefault,
    isActive: tier.isActive,
    derivationSource: tier.derivationSource,
    baseTierId: tier.baseTierId,
    multiplierBps: tier.multiplierBps,
    createdAt: tier.createdAt.toISOString(),
    updatedAt: tier.updatedAt.toISOString(),
  };
}
