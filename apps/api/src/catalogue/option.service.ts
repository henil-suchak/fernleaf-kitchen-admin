import { Injectable, NotFoundException } from '@nestjs/common';
import { type Option, Prisma } from '@prisma/client';

import { assertMinorUnits } from '../common/money/money.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  catalogueBusinessRuleError,
  catalogueValidationError,
  mapCataloguePrismaError,
} from './catalogue-errors.util';
import { normalizeCatalogueName } from './catalogue-name.util';
import type { OptionResponse } from './catalogue.types';
import type { CreateOptionDto } from './dto/create-option.dto';
import type { UpdateOptionDto } from './dto/update-option.dto';

const MAX_POSTGRES_INT = 2_147_483_647;

type CatalogueReferenceRecord = {
  id: string;
  name: string;
  isActive: boolean;
};

type OptionRecord = Option & {
  optionAllergens: Array<{ allergen: CatalogueReferenceRecord }>;
  optionDietaryTags: Array<{ dietaryTag: CatalogueReferenceRecord }>;
};

@Injectable()
export class OptionService {
  constructor(private readonly prisma: PrismaService) {}

  async listOptions(): Promise<OptionResponse[]> {
    const options = await this.prisma.option.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      include: optionReferenceIncludes,
    });

    return options.map(toOptionResponse);
  }

  async createOption(input: CreateOptionDto): Promise<OptionResponse> {
    const optionId = await this.prisma
      .$transaction(async (transaction) => {
        const allergenIds = input.allergenIds ?? [];
        const dietaryTagIds = input.dietaryTagIds ?? [];
        assertUniqueIds(allergenIds, 'allergenIds');
        assertUniqueIds(dietaryTagIds, 'dietaryTagIds');
        await validateActiveAllergens(transaction, allergenIds);
        await validateActiveDietaryTags(transaction, dietaryTagIds);

        const option = await transaction.option.create({
          data: {
            ...normalizeCatalogueName(input.name),
            costMinorUnits: validateCost(input.costMinorUnits),
          },
        });

        await createOptionReferences(
          transaction,
          option.id,
          allergenIds,
          dietaryTagIds,
        );
        return option.id;
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Option name already exists.',
          'Option not found.',
        );
      });

    return this.getOption(optionId);
  }

  async updateOption(id: string, input: UpdateOptionDto): Promise<OptionResponse> {
    const optionId = await this.prisma
      .$transaction(async (transaction) => {
        if (!hasOptionUpdate(input)) {
          throw catalogueValidationError(
            'option',
            'At least one option field must be provided.',
          );
        }

        const existing = await transaction.option.findUnique({
          where: { id },
          select: { id: true },
        });
        if (!existing) throw new NotFoundException('Option not found.');

        if (input.allergenIds !== undefined) {
          assertUniqueIds(input.allergenIds, 'allergenIds');
          await validateActiveAllergens(transaction, input.allergenIds);
        }
        if (input.dietaryTagIds !== undefined) {
          assertUniqueIds(input.dietaryTagIds, 'dietaryTagIds');
          await validateActiveDietaryTags(transaction, input.dietaryTagIds);
        }

        await transaction.option.update({
          where: { id },
          data: buildOptionUpdateData(input),
        });

        if (input.allergenIds !== undefined) {
          await transaction.optionAllergen.deleteMany({ where: { optionId: id } });
          await createOptionAllergens(transaction, id, input.allergenIds);
        }
        if (input.dietaryTagIds !== undefined) {
          await transaction.optionDietaryTag.deleteMany({ where: { optionId: id } });
          await createOptionDietaryTags(transaction, id, input.dietaryTagIds);
        }

        return id;
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Option name already exists.',
          'Option not found.',
        );
      });

    return this.getOption(optionId);
  }

  private async getOption(id: string): Promise<OptionResponse> {
    const option = await this.prisma.option.findUnique({
      where: { id },
      include: optionReferenceIncludes,
    });
    if (!option) throw new NotFoundException('Option not found.');

    return toOptionResponse(option);
  }
}

const optionReferenceIncludes = {
  optionAllergens: {
    include: { allergen: true },
    orderBy: { allergen: { name: 'asc' } },
  },
  optionDietaryTags: {
    include: { dietaryTag: true },
    orderBy: { dietaryTag: { name: 'asc' } },
  },
} as const;

function hasOptionUpdate(input: UpdateOptionDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function buildOptionUpdateData(
  input: UpdateOptionDto,
): Prisma.OptionUncheckedUpdateInput {
  const data: Prisma.OptionUncheckedUpdateInput = {};
  if (input.name !== undefined) Object.assign(data, normalizeCatalogueName(input.name));
  if (input.isActive !== undefined) data.isActive = input.isActive;
  if (input.costMinorUnits !== undefined) {
    data.costMinorUnits = validateCost(input.costMinorUnits);
  }
  return data;
}

function validateCost(value: number): number {
  try {
    const amount = assertMinorUnits(value, 'costMinorUnits');
    if (amount > MAX_POSTGRES_INT) throw new RangeError('costMinorUnits is too large.');
    return amount;
  } catch {
    throw catalogueValidationError(
      'costMinorUnits',
      'costMinorUnits must be a non-negative supported integer minor-unit amount.',
    );
  }
}

function assertUniqueIds(ids: readonly string[], field: string): void {
  if (new Set(ids).size !== ids.length) {
    throw catalogueValidationError(field, `${field} must not contain duplicates.`);
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

async function createOptionReferences(
  transaction: Prisma.TransactionClient,
  optionId: string,
  allergenIds: string[],
  dietaryTagIds: string[],
): Promise<void> {
  await Promise.all([
    createOptionAllergens(transaction, optionId, allergenIds),
    createOptionDietaryTags(transaction, optionId, dietaryTagIds),
  ]);
}

async function createOptionAllergens(
  transaction: Prisma.TransactionClient,
  optionId: string,
  allergenIds: string[],
): Promise<void> {
  if (allergenIds.length === 0) return;
  await transaction.optionAllergen.createMany({
    data: allergenIds.map((allergenId) => ({ optionId, allergenId })),
  });
}

async function createOptionDietaryTags(
  transaction: Prisma.TransactionClient,
  optionId: string,
  dietaryTagIds: string[],
): Promise<void> {
  if (dietaryTagIds.length === 0) return;
  await transaction.optionDietaryTag.createMany({
    data: dietaryTagIds.map((dietaryTagId) => ({ optionId, dietaryTagId })),
  });
}

function toOptionResponse(option: OptionRecord): OptionResponse {
  return {
    id: option.id,
    name: option.name,
    costMinorUnits: option.costMinorUnits,
    isActive: option.isActive,
    allergens: option.optionAllergens.map(({ allergen }) => ({
      id: allergen.id,
      name: allergen.name,
      isActive: allergen.isActive,
    })),
    dietaryTags: option.optionDietaryTags.map(({ dietaryTag }) => ({
      id: dietaryTag.id,
      name: dietaryTag.name,
      isActive: dietaryTag.isActive,
    })),
    createdAt: option.createdAt.toISOString(),
    updatedAt: option.updatedAt.toISOString(),
  };
}
