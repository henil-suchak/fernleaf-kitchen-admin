import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type OptionGroup } from '@prisma/client';

import { PrismaService } from '../prisma/prisma.service';
import {
  catalogueBusinessRuleError,
  catalogueValidationError,
  mapCataloguePrismaError,
} from './catalogue-errors.util';
import { normalizeCatalogueName } from './catalogue-name.util';
import type { CatalogueValueResponse, OptionGroupDetailResponse } from './catalogue.types';
import type { CreateOptionGroupDto } from './dto/create-option-group.dto';
import type {
  OptionGroupOptionInputDto,
  ReplaceOptionGroupOptionsDto,
} from './dto/replace-option-group-options.dto';
import type { UpdateOptionGroupDto } from './dto/update-option-group.dto';

type OptionReferenceRecord = {
  id: string;
  name: string;
  isActive: boolean;
};

type OptionGroupDetailRecord = OptionGroup & {
  optionGroupOptions: Array<{
    sortOrder: number;
    option: OptionReferenceRecord;
  }>;
};

@Injectable()
export class OptionGroupService {
  constructor(private readonly prisma: PrismaService) {}

  async listOptionGroups(): Promise<CatalogueValueResponse[]> {
    const optionGroups = await this.prisma.optionGroup.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return optionGroups.map(toCatalogueValueResponse);
  }

  async getOptionGroup(id: string): Promise<OptionGroupDetailResponse> {
    const optionGroup = await this.getOptionGroupRecord(id);

    if (!optionGroup) {
      throw new NotFoundException('Option group not found.');
    }

    return toOptionGroupDetailResponse(optionGroup);
  }

  async createOptionGroup(
    input: CreateOptionGroupDto,
  ): Promise<CatalogueValueResponse> {
    try {
      return toCatalogueValueResponse(
        await this.prisma.optionGroup.create({
          data: normalizeCatalogueName(input.name),
        }),
      );
    } catch (error: unknown) {
      throw mapCataloguePrismaError(
        error,
        'Option group name already exists.',
        'Option group not found.',
      );
    }
  }

  async updateOptionGroup(
    id: string,
    input: UpdateOptionGroupDto,
  ): Promise<CatalogueValueResponse> {
    if (input.name === undefined && input.isActive === undefined) {
      throw catalogueValidationError(
        'optionGroup',
        'At least one option group field must be provided.',
      );
    }

    const data: Prisma.OptionGroupUpdateInput = {};
    if (input.name !== undefined) {
      Object.assign(data, normalizeCatalogueName(input.name));
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    try {
      return toCatalogueValueResponse(
        await this.prisma.optionGroup.update({ where: { id }, data }),
      );
    } catch (error: unknown) {
      throw mapCataloguePrismaError(
        error,
        'Option group name already exists.',
        'Option group not found.',
      );
    }
  }

  async replaceOptionGroupOptions(
    optionGroupId: string,
    input: ReplaceOptionGroupOptionsDto,
  ): Promise<OptionGroupDetailResponse> {
    await this.prisma
      .$transaction(async (transaction) => {
        assertValidOptionMembership(input.options);

        const optionGroup = await transaction.optionGroup.findUnique({
          where: { id: optionGroupId },
          select: { isActive: true },
        });
        if (!optionGroup) {
          throw new NotFoundException('Option group not found.');
        }
        if (!optionGroup.isActive) {
          throw catalogueBusinessRuleError(
            'optionGroupId',
            'An inactive option group cannot receive new option membership.',
          );
        }

        await validateActiveOptions(
          transaction,
          input.options.map((option) => option.optionId),
        );

        await transaction.optionGroupOption.deleteMany({
          where: { optionGroupId },
        });
        if (input.options.length > 0) {
          await transaction.optionGroupOption.createMany({
            data: input.options.map((option) => ({
              optionGroupId,
              optionId: option.optionId,
              sortOrder: option.sortOrder,
            })),
          });
        }
      })
      .catch((error: unknown) => {
        throw mapCataloguePrismaError(
          error,
          'Option-group membership conflicts with an existing relationship.',
          'Option group not found.',
        );
      });

    return this.getOptionGroup(optionGroupId);
  }

  private getOptionGroupRecord(id: string) {
    return this.prisma.optionGroup.findUnique({
      where: { id },
      include: {
        optionGroupOptions: {
          orderBy: { sortOrder: 'asc' },
          include: { option: true },
        },
      },
    });
  }
}

function assertValidOptionMembership(
  options: OptionGroupOptionInputDto[],
): void {
  const optionIds = options.map((option) => option.optionId);
  if (new Set(optionIds).size !== optionIds.length) {
    throw catalogueValidationError(
      'options',
      'options must not contain duplicate optionId values.',
    );
  }

  const sortOrders = options.map((option) => option.sortOrder);
  if (new Set(sortOrders).size !== sortOrders.length) {
    throw catalogueValidationError(
      'options',
      'options must not contain duplicate sortOrder values.',
    );
  }
}

async function validateActiveOptions(
  transaction: Prisma.TransactionClient,
  ids: string[],
): Promise<void> {
  if (ids.length === 0) return;

  const options = await transaction.option.findMany({
    where: { id: { in: ids } },
    select: { id: true, isActive: true },
  });
  if (options.length !== ids.length) {
    throw new NotFoundException('Option not found.');
  }
  if (options.some((option) => !option.isActive)) {
    throw catalogueBusinessRuleError(
      'options',
      'Options must be active for new option-group membership.',
    );
  }
}

function toCatalogueValueResponse(
  value: OptionGroup,
): CatalogueValueResponse {
  return {
    id: value.id,
    name: value.name,
    isActive: value.isActive,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function toOptionGroupDetailResponse(
  optionGroup: OptionGroupDetailRecord,
): OptionGroupDetailResponse {
  return {
    ...toCatalogueValueResponse(optionGroup),
    options: optionGroup.optionGroupOptions.map((relationship) => ({
      id: relationship.option.id,
      name: relationship.option.name,
      isActive: relationship.option.isActive,
      sortOrder: relationship.sortOrder,
    })),
  };
}
