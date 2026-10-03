import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  type Allergen,
  type DietaryTag,
  type KitchenStation,
} from '@prisma/client';

import { ApiErrorCode } from '../common/errors/api-error-code';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateReferenceValueDto } from './dto/create-reference-value.dto';
import type { UpdateReferenceValueDto } from './dto/update-reference-value.dto';
import { normalizeReferenceName } from './reference-name.util';
import type { ReferenceValueResponse } from './reference-data.types';

@Injectable()
export class ReferenceDataService {
  constructor(private readonly prisma: PrismaService) {}

  async listAllergens(): Promise<ReferenceValueResponse[]> {
    const allergens = await this.prisma.allergen.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return allergens.map(toReferenceValueResponse);
  }

  async createAllergen(
    input: CreateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    const normalized = normalizeReferenceName(input.name);

    try {
      return toReferenceValueResponse(
        await this.prisma.allergen.create({ data: normalized }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Allergen');
    }
  }

  async updateAllergen(
    id: string,
    input: UpdateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    try {
      return toReferenceValueResponse(
        await this.prisma.allergen.update({
          where: { id },
          data: buildUpdateData(input),
        }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Allergen');
    }
  }

  async listDietaryTags(): Promise<ReferenceValueResponse[]> {
    const dietaryTags = await this.prisma.dietaryTag.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return dietaryTags.map(toReferenceValueResponse);
  }

  async createDietaryTag(
    input: CreateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    const normalized = normalizeReferenceName(input.name);

    try {
      return toReferenceValueResponse(
        await this.prisma.dietaryTag.create({ data: normalized }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Dietary tag');
    }
  }

  async updateDietaryTag(
    id: string,
    input: UpdateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    try {
      return toReferenceValueResponse(
        await this.prisma.dietaryTag.update({
          where: { id },
          data: buildUpdateData(input),
        }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Dietary tag');
    }
  }

  async listKitchenStations(): Promise<ReferenceValueResponse[]> {
    const kitchenStations = await this.prisma.kitchenStation.findMany({
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
    });

    return kitchenStations.map(toReferenceValueResponse);
  }

  async createKitchenStation(
    input: CreateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    const normalized = normalizeReferenceName(input.name);

    try {
      return toReferenceValueResponse(
        await this.prisma.kitchenStation.create({ data: normalized }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Kitchen station');
    }
  }

  async updateKitchenStation(
    id: string,
    input: UpdateReferenceValueDto,
  ): Promise<ReferenceValueResponse> {
    try {
      return toReferenceValueResponse(
        await this.prisma.kitchenStation.update({
          where: { id },
          data: buildUpdateData(input),
        }),
      );
    } catch (error: unknown) {
      throw mapReferenceDataError(error, 'Kitchen station');
    }
  }
}

interface ReferenceValueUpdateData {
  name?: string;
  normalizedName?: string;
  isActive?: boolean;
}

function buildUpdateData(
  input: UpdateReferenceValueDto,
): ReferenceValueUpdateData {
  if (input.name === undefined && input.isActive === undefined) {
    throw validationError(
      'referenceData',
      'At least one reference data field must be provided.',
    );
  }

  const data: ReferenceValueUpdateData = {};

  if (input.name !== undefined) {
    Object.assign(data, normalizeReferenceName(input.name));
  }

  if (input.isActive !== undefined) {
    data.isActive = input.isActive;
  }

  return data;
}

function toReferenceValueResponse(
  value: Allergen | DietaryTag | KitchenStation,
): ReferenceValueResponse {
  return {
    id: value.id,
    name: value.name,
    isActive: value.isActive,
    createdAt: value.createdAt.toISOString(),
    updatedAt: value.updatedAt.toISOString(),
  };
}

function mapReferenceDataError(error: unknown, label: string): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') {
      return new ConflictException(`${label} name already exists.`);
    }

    if (error.code === 'P2025') {
      return new NotFoundException(`${label} not found.`);
    }
  }

  return error instanceof Error ? error : new Error('Unexpected reference data error.');
}

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_ERROR,
    message: 'Some fields are invalid',
    details: [{ field, message }],
  });
}
