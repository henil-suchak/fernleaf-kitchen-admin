import { Injectable, NotFoundException } from '@nestjs/common';
import {
  Prisma,
  type Dish,
  type DishTemperature,
} from '@prisma/client';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { assertMinorUnits } from '../common/money/money.util';
import {
  createPaginatedResponse,
  toPaginationOptions,
} from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateDishDto } from './dto/create-dish.dto';
import type { DishListQueryDto } from './dto/dish-list-query.dto';
import type {
  DishOptionGroupInputDto,
  ReplaceDishOptionGroupsDto,
} from './dto/replace-dish-option-groups.dto';
import type { UpdateDishDto } from './dto/update-dish.dto';
import {
  catalogueBusinessRuleError,
  catalogueValidationError,
  mapCataloguePrismaError,
} from './catalogue-errors.util';
import { normalizeDisplayName, normalizeSku } from './catalogue-name.util';
import type {
  CatalogueReferenceResponse,
  DishDetailResponse,
  DishListItemResponse,
} from './catalogue.types';

type CatalogueReferenceRecord = {
  id: string;
  name: string;
  isActive: boolean;
};

type DishListRecord = Dish & {
  kitchenStation: CatalogueReferenceRecord | null;
};

type EmbeddedOptionRecord = CatalogueReferenceRecord & {
  costMinorUnits: number;
  optionAllergens: Array<{ allergen: CatalogueReferenceRecord }>;
  optionDietaryTags: Array<{ dietaryTag: CatalogueReferenceRecord }>;
};

type DishDetailRecord = DishListRecord & {
  dishAllergens: Array<{ allergen: CatalogueReferenceRecord }>;
  dishDietaryTags: Array<{ dietaryTag: CatalogueReferenceRecord }>;
  dishOptionGroups: Array<{
    isRequired: boolean;
    sortOrder: number;
    optionGroup: CatalogueReferenceRecord & {
      optionGroupOptions: Array<{
        sortOrder: number;
        option: EmbeddedOptionRecord;
      }>;
    };
  }>;
};

@Injectable()
export class DishService {
  constructor(private readonly prisma: PrismaService) {}

  async listDishes(
    query: DishListQueryDto,
  ): Promise<PaginatedResponse<DishListItemResponse>> {
    const { skip, take } = toPaginationOptions(query);
    const where: Prisma.DishWhereInput = {
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { sku: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
    const [dishes, total] = await this.prisma.$transaction([
      this.prisma.dish.findMany({
        where,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        skip,
        take,
        include: { kitchenStation: true },
      }),
      this.prisma.dish.count({ where }),
    ]);

    return createPaginatedResponse(
      dishes.map(toDishListItemResponse),
      total,
      query,
    );
  }

  async getDish(id: string): Promise<DishDetailResponse> {
    const dish = await this.getDishRecord(id);

    if (!dish) {
      throw new NotFoundException('Dish not found.');
    }

    return toDishDetailResponse(dish);
  }

  async createDish(input: CreateDishDto): Promise<DishDetailResponse> {
    const dishId = await this.prisma
      .$transaction(async (transaction) => {
        const allergenIds = input.allergenIds ?? [];
        const dietaryTagIds = input.dietaryTagIds ?? [];
        assertUniqueIds(allergenIds, 'allergenIds');
        assertUniqueIds(dietaryTagIds, 'dietaryTagIds');
        await this.validateDishReferences(
          transaction,
          input.kitchenStationId ?? null,
          allergenIds,
          dietaryTagIds,
        );

        const dish = await transaction.dish.create({
          data: {
            name: normalizeDisplayName(input.name),
            description: input.description ?? null,
            imageUrl: input.imageUrl ?? null,
            sku: normalizeSku(input.sku),
            temperature: input.temperature,
            costMinorUnits: validateCost(input.costMinorUnits),
            minimumQuantity: input.minimumQuantity,
            isActive: input.isActive ?? true,
            kitchenStationId: input.kitchenStationId ?? null,
          },
        });

        if (allergenIds.length > 0) {
          await transaction.dishAllergen.createMany({
            data: allergenIds.map((allergenId) => ({
              dishId: dish.id,
              allergenId,
            })),
          });
        }

        if (dietaryTagIds.length > 0) {
          await transaction.dishDietaryTag.createMany({
            data: dietaryTagIds.map((dietaryTagId) => ({
              dishId: dish.id,
              dietaryTagId,
            })),
          });
        }

        return dish.id;
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Dish SKU already exists.',
          'Dish not found.',
        );
      });

    return this.getDish(dishId);
  }

  async updateDish(id: string, input: UpdateDishDto): Promise<DishDetailResponse> {
    const dishId = await this.prisma
      .$transaction(async (transaction) => {
        if (!hasDishUpdate(input)) {
          throw catalogueValidationError(
            'dish',
            'At least one dish field must be provided.',
          );
        }

        const existing = await transaction.dish.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) {
          throw new NotFoundException('Dish not found.');
        }

        if (input.allergenIds !== undefined) {
          assertUniqueIds(input.allergenIds, 'allergenIds');
          await validateActiveAllergens(transaction, input.allergenIds);
        }

        if (input.dietaryTagIds !== undefined) {
          assertUniqueIds(input.dietaryTagIds, 'dietaryTagIds');
          await validateActiveDietaryTags(transaction, input.dietaryTagIds);
        }

        if (input.kitchenStationId !== undefined && input.kitchenStationId !== null) {
          await validateActiveKitchenStation(transaction, input.kitchenStationId);
        }

        await transaction.dish.update({
          where: { id },
          data: buildDishUpdateData(input),
        });

        if (input.allergenIds !== undefined) {
          await transaction.dishAllergen.deleteMany({ where: { dishId: id } });
          if (input.allergenIds.length > 0) {
            await transaction.dishAllergen.createMany({
              data: input.allergenIds.map((allergenId) => ({
                dishId: id,
                allergenId,
              })),
            });
          }
        }

        if (input.dietaryTagIds !== undefined) {
          await transaction.dishDietaryTag.deleteMany({ where: { dishId: id } });
          if (input.dietaryTagIds.length > 0) {
            await transaction.dishDietaryTag.createMany({
              data: input.dietaryTagIds.map((dietaryTagId) => ({
                dishId: id,
                dietaryTagId,
              })),
            });
          }
        }

        return id;
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Dish SKU already exists.',
          'Dish not found.',
        );
      });

    return this.getDish(dishId);
  }

  async replaceDishOptionGroups(
    dishId: string,
    input: ReplaceDishOptionGroupsDto,
  ): Promise<DishDetailResponse> {
    await this.prisma
      .$transaction(async (transaction) => {
        assertValidDishOptionGroups(input.groups);

        const dish = await transaction.dish.findUnique({
          where: { id: dishId },
          select: { isActive: true },
        });
        if (!dish) {
          throw new NotFoundException('Dish not found.');
        }
        if (!dish.isActive) {
          throw catalogueBusinessRuleError(
            'dishId',
            'An inactive dish cannot receive new option-group configuration.',
          );
        }

        await validateActiveOptionGroups(
          transaction,
          input.groups.map((group) => group.optionGroupId),
        );

        await transaction.dishOptionGroup.deleteMany({ where: { dishId } });
        if (input.groups.length > 0) {
          await transaction.dishOptionGroup.createMany({
            data: input.groups.map((group) => ({
              dishId,
              optionGroupId: group.optionGroupId,
              isRequired: group.isRequired,
              sortOrder: group.sortOrder,
            })),
          });
        }
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Dish option-group configuration conflicts with an existing relationship.',
          'Dish not found.',
        );
      });

    return this.getDish(dishId);
  }

  private async validateDishReferences(
    transaction: Prisma.TransactionClient,
    kitchenStationId: string | null,
    allergenIds: string[],
    dietaryTagIds: string[],
  ): Promise<void> {
    if (kitchenStationId) {
      await validateActiveKitchenStation(transaction, kitchenStationId);
    }
    await validateActiveAllergens(transaction, allergenIds);
    await validateActiveDietaryTags(transaction, dietaryTagIds);
  }

  private getDishRecord(id: string) {
    return this.prisma.dish.findUnique({
      where: { id },
      include: {
        kitchenStation: true,
        dishAllergens: {
          include: { allergen: true },
          orderBy: { allergen: { name: 'asc' } },
        },
        dishDietaryTags: {
          include: { dietaryTag: true },
          orderBy: { dietaryTag: { name: 'asc' } },
        },
        dishOptionGroups: {
          orderBy: { sortOrder: 'asc' },
          include: {
            optionGroup: {
              include: {
                optionGroupOptions: {
                  orderBy: { sortOrder: 'asc' },
                  include: {
                    option: {
                      include: {
                        optionAllergens: {
                          include: { allergen: true },
                          orderBy: { allergen: { name: 'asc' } },
                        },
                        optionDietaryTags: {
                          include: { dietaryTag: true },
                          orderBy: { dietaryTag: { name: 'asc' } },
                        },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    });
  }
}

function hasDishUpdate(input: UpdateDishDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function buildDishUpdateData(input: UpdateDishDto): Prisma.DishUncheckedUpdateInput {
  const data: Prisma.DishUncheckedUpdateInput = {};

  if (input.name !== undefined) data.name = normalizeDisplayName(input.name);
  if (input.description !== undefined) data.description = input.description;
  if (input.imageUrl !== undefined) data.imageUrl = input.imageUrl;
  if (input.sku !== undefined) data.sku = normalizeSku(input.sku);
  if (input.temperature !== undefined) data.temperature = input.temperature;
  if (input.costMinorUnits !== undefined) {
    data.costMinorUnits = validateCost(input.costMinorUnits);
  }
  if (input.minimumQuantity !== undefined) data.minimumQuantity = input.minimumQuantity;
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.kitchenStationId !== undefined) {
    data.kitchenStationId = input.kitchenStationId;
  }

  return data;
}

function validateCost(value: number): number {
  try {
    return assertMinorUnits(value, 'costMinorUnits');
  } catch {
    throw catalogueValidationError(
      'costMinorUnits',
      'costMinorUnits must be a non-negative safe integer.',
    );
  }
}

function assertUniqueIds(ids: readonly string[], field: string): void {
  if (new Set(ids).size !== ids.length) {
    throw catalogueValidationError(field, `${field} must not contain duplicates.`);
  }
}

function assertUniqueSortOrders(
  values: readonly { sortOrder: number }[],
  field: string,
): void {
  if (new Set(values.map((value) => value.sortOrder)).size !== values.length) {
    throw catalogueValidationError(field, `${field} must not contain duplicate sortOrder values.`);
  }
}

function assertValidDishOptionGroups(groups: DishOptionGroupInputDto[]): void {
  assertUniqueIds(groups.map((group) => group.optionGroupId), 'groups');
  assertUniqueSortOrders(groups, 'groups');
}

async function validateActiveKitchenStation(
  transaction: Prisma.TransactionClient,
  id: string,
): Promise<void> {
  const station = await transaction.kitchenStation.findUnique({
    where: { id },
    select: { isActive: true },
  });
  if (!station) throw new NotFoundException('Kitchen station not found.');
  if (!station.isActive) {
    throw catalogueBusinessRuleError(
      'kitchenStationId',
      'Kitchen station must be active.',
    );
  }
}

async function validateActiveAllergens(
  transaction: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const allergens = await transaction.allergen.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });
  if (allergens.length !== ids.length) throw new NotFoundException('Allergen not found.');
  if (allergens.some((allergen) => !allergen.isActive)) {
    throw catalogueBusinessRuleError('allergenIds', 'Allergens must be active.');
  }
}

async function validateActiveDietaryTags(
  transaction: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const dietaryTags = await transaction.dietaryTag.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });
  if (dietaryTags.length !== ids.length) {
    throw new NotFoundException('Dietary tag not found.');
  }
  if (dietaryTags.some((dietaryTag) => !dietaryTag.isActive)) {
    throw catalogueBusinessRuleError('dietaryTagIds', 'Dietary tags must be active.');
  }
}

async function validateActiveOptionGroups(
  transaction: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;
  const optionGroups = await transaction.optionGroup.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });
  if (optionGroups.length !== ids.length) {
    throw new NotFoundException('Option group not found.');
  }
  if (optionGroups.some((optionGroup) => !optionGroup.isActive)) {
    throw catalogueBusinessRuleError(
      'groups',
      'Option groups must be active for new dish configuration.',
    );
  }
}

function toCatalogueReference(value: {
  id: string;
  name: string;
  isActive: boolean;
}): CatalogueReferenceResponse {
  return { id: value.id, name: value.name, isActive: value.isActive };
}

function toDishListItemResponse(
  dish: DishListRecord,
): DishListItemResponse {
  return {
    id: dish.id,
    name: dish.name,
    sku: dish.sku,
    temperature: dish.temperature as DishTemperature,
    costMinorUnits: dish.costMinorUnits,
    minimumQuantity: dish.minimumQuantity,
    isActive: dish.isActive,
    kitchenStation: dish.kitchenStation ? toCatalogueReference(dish.kitchenStation) : null,
    updatedAt: dish.updatedAt.toISOString(),
  };
}

function toDishDetailResponse(dish: DishDetailRecord): DishDetailResponse {
  const base = toDishListItemResponse(dish);

  return {
    ...base,
    description: dish.description,
    imageUrl: dish.imageUrl,
    createdAt: dish.createdAt.toISOString(),
    allergens: dish.dishAllergens.map(({ allergen }) => toCatalogueReference(allergen)),
    dietaryTags: dish.dishDietaryTags.map(({ dietaryTag }) =>
      toCatalogueReference(dietaryTag),
    ),
    optionGroups: dish.dishOptionGroups.map((relationship) => ({
      ...toCatalogueReference(relationship.optionGroup),
      isRequired: relationship.isRequired,
      sortOrder: relationship.sortOrder,
      options: relationship.optionGroup.optionGroupOptions.map((optionRelationship) => ({
        ...toCatalogueReference(optionRelationship.option),
        costMinorUnits: optionRelationship.option.costMinorUnits,
        allergens: optionRelationship.option.optionAllergens.map(({ allergen }) =>
          toCatalogueReference(allergen),
        ),
        dietaryTags: optionRelationship.option.optionDietaryTags.map(({ dietaryTag }) =>
          toCatalogueReference(dietaryTag),
        ),
        sortOrder: optionRelationship.sortOrder,
      })),
    })),
  };
}
