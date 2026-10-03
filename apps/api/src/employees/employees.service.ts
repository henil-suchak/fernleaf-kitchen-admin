import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { PaginatedResponse } from '@fernleaf/contracts';

import {
  createPaginatedResponse,
  toPaginationOptions,
} from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import {
  employeeBusinessRuleError,
  employeeValidationError,
  mapEmployeePrismaError,
} from './employee-errors.util';
import { normalizeEmployeeEmail, normalizeEmployeeName } from './employee-name.util';
import type { CreateEmployeeDto } from './dto/create-employee.dto';
import type { EmployeeListQueryDto } from './dto/employee-list-query.dto';
import type { UpdateEmployeeDto } from './dto/update-employee.dto';
import type { EmployeeResponse, EmployeeSummaryResponse } from './employee.types';

const employeeInclude = Prisma.validator<Prisma.EmployeeInclude>()({
  company: { select: { id: true, name: true, isActive: true, ownerEmployeeId: true } },
  allergens: { include: { allergen: true }, orderBy: { allergenId: 'asc' } },
  dietaryTags: { include: { dietaryTag: true }, orderBy: { dietaryTagId: 'asc' } },
});

type EmployeeWithRelations = Prisma.EmployeeGetPayload<{
  include: typeof employeeInclude;
}>;

@Injectable()
export class EmployeesService {
  constructor(private readonly prisma: PrismaService) {}

  async listEmployees(
    query: EmployeeListQueryDto,
  ): Promise<PaginatedResponse<EmployeeSummaryResponse>> {
    const { skip, take } = toPaginationOptions(query);
    const where: Prisma.EmployeeWhereInput = {
      ...(query.companyId ? { companyId: query.companyId } : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
              { email: { contains: query.search, mode: Prisma.QueryMode.insensitive } },
            ],
          }
        : {}),
    };
    const [employees, total] = await this.prisma.$transaction([
      this.prisma.employee.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: { company: { select: { id: true, name: true, isActive: true } } },
      }),
      this.prisma.employee.count({ where }),
    ]);
    return createPaginatedResponse(employees.map(toEmployeeSummary), total, query);
  }

  async getEmployee(id: string): Promise<EmployeeResponse> {
    const employee = await this.prisma.employee.findUnique({
      where: { id },
      include: employeeInclude,
    });
    if (!employee) throw new NotFoundException('Employee not found.');
    return toEmployeeResponse(employee);
  }

  async createEmployee(input: CreateEmployeeDto): Promise<EmployeeResponse> {
    const employee = await this.prisma
      .$transaction(async (transaction) => {
        await requireActiveCompany(transaction, input.companyId);
        const allergenIds = input.allergenIds ?? [];
        const dietaryTagIds = input.dietaryTagIds ?? [];
        await validateActiveAllergens(transaction, allergenIds);
        await validateActiveDietaryTags(transaction, dietaryTagIds);

        return transaction.employee.create({
          data: {
            companyId: input.companyId,
            name: normalizeName(input.name),
            email: normalizeEmail(input.email),
            phone: input.phone ?? null,
            canChooseDeliveryAddress: input.canChooseDeliveryAddress ?? false,
            canChangeDeliveryTime: input.canChangeDeliveryTime ?? false,
            canChangePackaging: input.canChangePackaging ?? false,
            allergens: { create: allergenIds.map((allergenId) => ({ allergenId })) },
            dietaryTags: { create: dietaryTagIds.map((dietaryTagId) => ({ dietaryTagId })) },
          },
          include: employeeInclude,
        });
      })
      .catch((error: unknown) => {
        throw mapEmployeePrismaError(error);
      });
    return toEmployeeResponse(employee);
  }

  async updateEmployee(id: string, input: UpdateEmployeeDto): Promise<EmployeeResponse> {
    if (!hasEmployeeUpdate(input)) {
      throw employeeValidationError('employee', 'At least one Employee field must be provided.');
    }

    const ownershipSensitive = input.companyId !== undefined || input.isActive === false;
    const update = async (transaction: Prisma.TransactionClient) => {
      const current = await transaction.employee.findUnique({
        where: { id },
        include: { company: { select: { ownerEmployeeId: true } } },
      });
      if (!current) throw new NotFoundException('Employee not found.');

      const moving = input.companyId !== undefined && input.companyId !== current.companyId;
      const deactivating = input.isActive === false && current.isActive;
      if (current.company.ownerEmployeeId === id && (moving || deactivating)) {
        throw employeeBusinessRuleError(
          moving ? 'companyId' : 'isActive',
          moving
            ? "Reassign the Company's owner before moving this Employee."
            : "Reassign the Company's owner before deactivating this Employee.",
        );
      }

      const destinationCompanyId = input.companyId ?? current.companyId;
      if (moving || (input.isActive === true && !current.isActive)) {
        await requireActiveCompany(transaction, destinationCompanyId);
      }
      if (input.allergenIds !== undefined) {
        await validateActiveAllergens(transaction, input.allergenIds);
      }
      if (input.dietaryTagIds !== undefined) {
        await validateActiveDietaryTags(transaction, input.dietaryTagIds);
      }

      const data: Prisma.EmployeeUpdateInput = {};
      if (input.companyId !== undefined) data.company = { connect: { id: input.companyId } };
      if (input.name !== undefined) data.name = normalizeName(input.name);
      if (input.email !== undefined) data.email = normalizeEmail(input.email);
      if (input.phone !== undefined) data.phone = input.phone;
      if (input.canChooseDeliveryAddress !== undefined) {
        data.canChooseDeliveryAddress = input.canChooseDeliveryAddress;
      }
      if (input.canChangeDeliveryTime !== undefined) data.canChangeDeliveryTime = input.canChangeDeliveryTime;
      if (input.canChangePackaging !== undefined) data.canChangePackaging = input.canChangePackaging;
      if (input.isActive !== undefined) data.isActive = input.isActive;
      if (input.allergenIds !== undefined) {
        data.allergens = {
          deleteMany: {},
          create: input.allergenIds.map((allergenId) => ({ allergenId })),
        };
      }
      if (input.dietaryTagIds !== undefined) {
        data.dietaryTags = {
          deleteMany: {},
          create: input.dietaryTagIds.map((dietaryTagId) => ({ dietaryTagId })),
        };
      }

      return transaction.employee.update({ where: { id }, data, include: employeeInclude });
    };

    const employee = await (ownershipSensitive
      ? this.prisma.$transaction(update, {
          isolationLevel: Prisma.TransactionIsolationLevel.Serializable,
        })
      : this.prisma.$transaction(update)
    ).catch((error: unknown) => {
      throw mapEmployeePrismaError(error);
    });

    return toEmployeeResponse(employee);
  }
}

function hasEmployeeUpdate(input: UpdateEmployeeDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function normalizeName(value: string): string {
  try {
    return normalizeEmployeeName(value);
  } catch {
    throw employeeValidationError('name', 'name must not be blank.');
  }
}

function normalizeEmail(value: string): string {
  try {
    return normalizeEmployeeEmail(value);
  } catch {
    throw employeeValidationError('email', 'email must not be blank.');
  }
}

async function requireActiveCompany(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  const company = await transaction.company.findUnique({
    where: { id: companyId },
    select: { isActive: true },
  });
  if (!company) throw new NotFoundException('Company not found.');
  if (!company.isActive) {
    throw employeeBusinessRuleError('companyId', 'Company must be active.');
  }
}

async function validateActiveAllergens(
  transaction: Prisma.TransactionClient,
  allergenIds: readonly string[],
): Promise<void> {
  if (allergenIds.length === 0) return;
  const allergens = await transaction.allergen.findMany({
    where: { id: { in: [...allergenIds] }, isActive: true },
    select: { id: true },
  });
  if (allergens.length !== allergenIds.length) {
    throw employeeBusinessRuleError('allergenIds', 'Allergens must exist and be active.');
  }
}

async function validateActiveDietaryTags(
  transaction: Prisma.TransactionClient,
  dietaryTagIds: readonly string[],
): Promise<void> {
  if (dietaryTagIds.length === 0) return;
  const dietaryTags = await transaction.dietaryTag.findMany({
    where: { id: { in: [...dietaryTagIds] }, isActive: true },
    select: { id: true },
  });
  if (dietaryTags.length !== dietaryTagIds.length) {
    throw employeeBusinessRuleError('dietaryTagIds', 'Dietary tags must exist and be active.');
  }
}

function toEmployeeSummary(employee: {
  id: string;
  name: string;
  email: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  company: { id: string; name: string; isActive: boolean };
}): EmployeeSummaryResponse {
  return {
    id: employee.id,
    name: employee.name,
    email: employee.email,
    isActive: employee.isActive,
    company: employee.company,
    createdAt: employee.createdAt.toISOString(),
    updatedAt: employee.updatedAt.toISOString(),
  };
}

function toEmployeeResponse(employee: EmployeeWithRelations): EmployeeResponse {
  return {
    ...toEmployeeSummary(employee),
    phone: employee.phone,
    canChooseDeliveryAddress: employee.canChooseDeliveryAddress,
    canChangeDeliveryTime: employee.canChangeDeliveryTime,
    canChangePackaging: employee.canChangePackaging,
    allergens: employee.allergens.map(({ allergen }) => ({
      id: allergen.id,
      name: allergen.name,
      isActive: allergen.isActive,
    })),
    dietaryTags: employee.dietaryTags.map(({ dietaryTag }) => ({
      id: dietaryTag.id,
      name: dietaryTag.name,
      isActive: dietaryTag.isActive,
    })),
    isCompanyOwner: employee.company.ownerEmployeeId === employee.id,
  };
}
