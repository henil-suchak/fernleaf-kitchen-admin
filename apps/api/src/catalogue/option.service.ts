import { Injectable } from '@nestjs/common';
import { type Option, Prisma } from '@prisma/client';

import {
  catalogueValidationError,
  mapCataloguePrismaError,
} from './catalogue-errors.util';
import { normalizeCatalogueName } from './catalogue-name.util';
import type { CreateOptionDto } from './dto/create-option.dto';
import type { UpdateOptionDto } from './dto/update-option.dto';
import type { CatalogueValueResponse } from './catalogue.types';
import { PrismaService } from '../prisma/prisma.service';

@Injectable()
export class OptionService {
  constructor(private readonly prisma: PrismaService) {}

  async listOptions(): Promise<CatalogueValueResponse[]> {
    const options = await this.prisma.option.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return options.map(toCatalogueValueResponse);
  }

  async createOption(input: CreateOptionDto): Promise<CatalogueValueResponse> {
    try {
      return toCatalogueValueResponse(
        await this.prisma.option.create({
          data: normalizeCatalogueName(input.name),
        }),
      );
    } catch (error: unknown) {
      throw mapCataloguePrismaError(
        error,
        'Option name already exists.',
        'Option not found.',
      );
    }
  }

  async updateOption(
    id: string,
    input: UpdateOptionDto,
  ): Promise<CatalogueValueResponse> {
    if (input.name === undefined && input.isActive === undefined) {
      throw catalogueValidationError(
        'option',
        'At least one option field must be provided.',
      );
    }

    const data: Prisma.OptionUpdateInput = {};
    if (input.name !== undefined) {
      Object.assign(data, normalizeCatalogueName(input.name));
    }
    if (input.isActive !== undefined) data.isActive = input.isActive;

    try {
      return toCatalogueValueResponse(
        await this.prisma.option.update({ where: { id }, data }),
      );
    } catch (error: unknown) {
      throw mapCataloguePrismaError(
        error,
        'Option name already exists.',
        'Option not found.',
      );
    }
  }
}

function toCatalogueValueResponse(option: Option): CatalogueValueResponse {
  return {
    id: option.id,
    name: option.name,
    isActive: option.isActive,
    createdAt: option.createdAt.toISOString(),
    updatedAt: option.updatedAt.toISOString(),
  };
}
