import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Weekday } from '@prisma/client';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { PermissionCode } from '../authorization/permission-code';
import {
  createPaginatedResponse,
  toPaginationOptions,
} from '../common/pagination/pagination.util';
import { PrismaService } from '../prisma/prisma.service';
import { formatHolidayDate, parseHolidayDate } from '../settings/settings-date.util';
import {
  cutoffTimeToMinutes as deliveryTimeToMinutes,
  minutesToCutoffTime as minutesToDeliveryTime,
} from '../settings/settings-time.util';
import { WEEKDAY_ORDER } from '../settings/settings.types';
import { normalizeCompanyDomain } from './company-domain.util';
import {
  companyBusinessRuleError,
  companyValidationError,
  mapCompanyPrismaError,
} from './company-errors.util';
import { normalizeCompanyName } from './company-name.util';
import type { CompanyAddressDto } from './dto/company-address.dto';
import type { CompanyListQueryDto } from './dto/company-list-query.dto';
import type { CreateCompanyDto } from './dto/create-company.dto';
import type { CreateCompanyHolidayDto } from './dto/create-company-holiday.dto';
import type { ReplaceCompanyDomainsDto } from './dto/replace-company-domains.dto';
import type { UpdateCompanyAddressDto } from './dto/update-company-address.dto';
import type { UpdateCompanyDto } from './dto/update-company.dto';
import type {
  CompanyAddressResponse,
  CompanyHolidayResponse,
  CompanyResponse,
  CompanySummaryResponse,
} from './company.types';

const companyInclude = Prisma.validator<Prisma.CompanyInclude>()({
  pricingTier: { select: { id: true, name: true, derivationSource: true } },
  defaultDriver: {
    select: { id: true, email: true, role: { select: { code: true, name: true } } },
  },
  emailDomains: { orderBy: { domain: 'asc' } },
  addresses: { orderBy: [{ label: 'asc' }, { id: 'asc' }] },
  holidays: { orderBy: { date: 'asc' } },
});

type CompanyWithRelations = Prisma.CompanyGetPayload<{
  include: typeof companyInclude;
}>;

const driverPermissions = [
  PermissionCode.DELIVERY_OWN_READ,
  PermissionCode.DELIVERY_OWN_UPDATE,
] as const;

const DEFAULT_COMPANY_WORKING_DAYS: Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
];

@Injectable()
export class CompanyService {
  constructor(private readonly prisma: PrismaService) {}

  async listCompanies(
    query: CompanyListQueryDto,
  ): Promise<PaginatedResponse<CompanySummaryResponse>> {
    const { skip, take } = toPaginationOptions(query);
    const where: Prisma.CompanyWhereInput = {
      ...(query.search
        ? { name: { contains: query.search, mode: Prisma.QueryMode.insensitive } }
        : {}),
      ...(query.isActive === undefined ? {} : { isActive: query.isActive }),
    };
    const [companies, total] = await this.prisma.$transaction([
      this.prisma.company.findMany({
        where,
        skip,
        take,
        orderBy: [{ name: 'asc' }, { id: 'asc' }],
        include: {
          pricingTier: { select: { id: true, name: true, derivationSource: true } },
        },
      }),
      this.prisma.company.count({ where }),
    ]);

    return createPaginatedResponse(
      companies.map(toCompanySummaryResponse),
      total,
      query,
    );
  }

  async getCompany(id: string): Promise<CompanyResponse> {
    const company = await this.prisma.company.findUnique({
      where: { id },
      include: companyInclude,
    });
    if (!company) throw new NotFoundException('Company not found.');

    return toCompanyResponse(company);
  }

  async createCompany(input: CreateCompanyDto): Promise<CompanyResponse> {
    const domains = normalizeDomains(input.domains);
    const workingDays = normalizeWorkingDays(
      input.workingDays ?? DEFAULT_COMPANY_WORKING_DAYS,
    );
    const name = normalizeCompanyName(input.name);
    const defaultDeliveryTimeMinutes = input.defaultDeliveryTime
      ? deliveryTimeToMinutes(input.defaultDeliveryTime)
      : 12 * 60 + 30;

    const company = await this.prisma
      .$transaction(
        async (transaction) => {
          await validatePricingTier(transaction, input.pricingTierId ?? null);
          await validateDefaultDriver(transaction, input.defaultDriverId ?? null);

          return transaction.company.create({
            data: {
              ...name,
              billingContactName: input.billingContact.name,
              billingContactEmail: input.billingContact.email.toLowerCase(),
              billingContactPhone: input.billingContact.phone ?? null,
              workingDays,
              defaultDeliveryTimeMinutes,
              deliveryMinutesBefore: input.deliveryMinutesBefore ?? 60,
              defaultPackaging: input.defaultPackaging,
              driverInstructions: input.driverInstructions ?? null,
              pricingTierId: input.pricingTierId ?? null,
              defaultDriverId: input.defaultDriverId ?? null,
              emailDomains: { create: domains.map((domain) => ({ domain })) },
              addresses: { create: input.addresses.map(toAddressCreateData) },
            },
            include: companyInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        throw mapCompanyPrismaError(
          error,
          'A Company already owns one of these domains.',
          'Referenced Company data was not found.',
        );
      });

    return toCompanyResponse(company);
  }

  async updateCompany(id: string, input: UpdateCompanyDto): Promise<CompanyResponse> {
    if (!hasCompanyUpdate(input)) {
      throw companyValidationError('company', 'At least one Company field must be provided.');
    }

    const company = await this.prisma
      .$transaction(
        async (transaction) => {
          const current = await transaction.company.findUnique({ where: { id } });
          if (!current) throw new NotFoundException('Company not found.');

          const isActive = input.isActive ?? current.isActive;
          if (isActive) await assertCompanyHasActiveAddress(transaction, id);
          if (input.pricingTierId !== undefined) {
            await validatePricingTier(transaction, input.pricingTierId);
          }
          if (input.defaultDriverId !== undefined) {
            await validateDefaultDriver(transaction, input.defaultDriverId);
          }
          if (input.ownerEmployeeId !== undefined) {
            await validateOwnerEmployee(
              transaction,
              id,
              isActive,
              current.ownerEmployeeId,
              input.ownerEmployeeId,
            );
          }

          const data: Prisma.CompanyUncheckedUpdateInput = { isActive };
          if (input.name !== undefined) Object.assign(data, normalizeCompanyName(input.name));
          if (input.billingContact !== undefined) {
            data.billingContactName = input.billingContact.name;
            data.billingContactEmail = input.billingContact.email.toLowerCase();
            data.billingContactPhone = input.billingContact.phone ?? null;
          }
          if (input.workingDays !== undefined) {
            data.workingDays = { set: normalizeWorkingDays(input.workingDays) };
          }
          if (input.defaultDeliveryTime !== undefined) {
            data.defaultDeliveryTimeMinutes = deliveryTimeToMinutes(input.defaultDeliveryTime);
          }
          if (input.deliveryMinutesBefore !== undefined) {
            data.deliveryMinutesBefore = input.deliveryMinutesBefore;
          }
          if (input.defaultPackaging !== undefined) data.defaultPackaging = input.defaultPackaging;
          if (input.driverInstructions !== undefined) data.driverInstructions = input.driverInstructions;
          if (input.pricingTierId !== undefined) data.pricingTierId = input.pricingTierId;
          if (input.defaultDriverId !== undefined) data.defaultDriverId = input.defaultDriverId;
          if (input.ownerEmployeeId !== undefined) data.ownerEmployeeId = input.ownerEmployeeId;

          return transaction.company.update({ where: { id }, data, include: companyInclude });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        throw mapCompanyPrismaError(
          error,
          'A Company update conflicted with existing data.',
          'Company not found.',
        );
      });

    return toCompanyResponse(company);
  }

  async replaceDomains(id: string, input: ReplaceCompanyDomainsDto): Promise<CompanyResponse> {
    const domains = normalizeDomains(input.domains);
    const company = await this.prisma
      .$transaction(
        async (transaction) => {
          await requireCompany(transaction, id);
          await transaction.companyEmailDomain.deleteMany({ where: { companyId: id } });
          return transaction.company.update({
            where: { id },
            data: { emailDomains: { create: domains.map((domain) => ({ domain })) } },
            include: companyInclude,
          });
        },
        { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
      )
      .catch((error: unknown) => {
        throw mapCompanyPrismaError(
          error,
          'A Company already owns one of these domains.',
          'Company not found.',
        );
      });

    return toCompanyResponse(company);
  }

  async addAddress(id: string, input: CompanyAddressDto): Promise<CompanyAddressResponse> {
    await this.requireCompany(id);
    const address = await this.prisma.companyAddress.create({
      data: { companyId: id, ...toAddressCreateData(input) },
    });
    return toAddressResponse(address);
  }

  async updateAddress(
    companyId: string,
    addressId: string,
    input: UpdateCompanyAddressDto,
  ): Promise<CompanyAddressResponse> {
    if (!hasAddressUpdate(input)) {
      throw companyValidationError('address', 'At least one address field must be provided.');
    }

    const address = await this.prisma.$transaction(
      async (transaction) => {
        const company = await transaction.company.findUnique({ where: { id: companyId } });
        if (!company) throw new NotFoundException('Company not found.');
        const current = await transaction.companyAddress.findFirst({
          where: { id: addressId, companyId },
        });
        if (!current) throw new NotFoundException('Company address not found.');

        if (company.isActive && current.isActive && input.isActive === false) {
          const activeAddressCount = await transaction.companyAddress.count({
            where: { companyId, isActive: true },
          });
          if (activeAddressCount <= 1) {
            throw companyBusinessRuleError(
              'isActive',
              'An active Company must retain at least one active address.',
            );
          }
        }

        const data: Prisma.CompanyAddressUpdateInput = {};
        if (input.label !== undefined) data.label = input.label;
        if (input.addressLine1 !== undefined) data.addressLine1 = input.addressLine1;
        if (input.addressLine2 !== undefined) data.addressLine2 = input.addressLine2;
        if (input.city !== undefined) data.city = input.city;
        if (input.stateRegion !== undefined) data.stateRegion = input.stateRegion;
        if (input.postalCode !== undefined) data.postalCode = input.postalCode;
        if (input.country !== undefined) data.country = input.country;
        if (input.isActive !== undefined) data.isActive = input.isActive;

        return transaction.companyAddress.update({ where: { id: addressId }, data });
      },
      { isolationLevel: Prisma.TransactionIsolationLevel.Serializable },
    );

    return toAddressResponse(address);
  }

  async listHolidays(id: string): Promise<CompanyHolidayResponse[]> {
    await this.requireCompany(id);
    const holidays = await this.prisma.companyHoliday.findMany({
      where: { companyId: id },
      orderBy: { date: 'asc' },
    });
    return holidays.map(toHolidayResponse);
  }

  async addHoliday(
    companyId: string,
    input: CreateCompanyHolidayDto,
  ): Promise<CompanyHolidayResponse> {
    let date: Date;
    try {
      date = parseHolidayDate(input.date);
    } catch {
      throw companyValidationError('date', 'date must be a valid calendar date.');
    }

    try {
      await this.requireCompany(companyId);
      const holiday = await this.prisma.companyHoliday.create({
        data: { companyId, date, name: input.name ?? null },
      });
      return toHolidayResponse(holiday);
    } catch (error: unknown) {
      throw mapCompanyPrismaError(
        error,
        'A Company holiday already exists for this date.',
        'Company not found.',
      );
    }
  }

  async removeHoliday(companyId: string, holidayId: string): Promise<void> {
    await this.requireCompany(companyId);
    const result = await this.prisma.companyHoliday.deleteMany({
      where: { id: holidayId, companyId },
    });
    if (result.count === 0) throw new NotFoundException('Company holiday not found.');
  }

  private async requireCompany(id: string): Promise<void> {
    await requireCompany(this.prisma, id);
  }
}

function normalizeDomains(domains: readonly string[]): string[] {
  let normalized: string[];
  try {
    normalized = domains.map(normalizeCompanyDomain);
  } catch (error) {
    throw companyValidationError(
      'domains',
      error instanceof Error ? error.message : 'domains are invalid.',
    );
  }
  if (new Set(normalized).size !== normalized.length) {
    throw companyValidationError('domains', 'domains must not contain duplicates.');
  }
  return normalized;
}

function normalizeWorkingDays(workingDays: readonly Weekday[]): Weekday[] {
  if (workingDays.length === 0) {
    throw companyValidationError('workingDays', 'workingDays must contain at least one day.');
  }
  if (new Set(workingDays).size !== workingDays.length) {
    throw companyValidationError('workingDays', 'workingDays must not contain duplicates.');
  }
  return WEEKDAY_ORDER.filter((weekday) => workingDays.includes(weekday));
}

async function validatePricingTier(
  transaction: Prisma.TransactionClient,
  pricingTierId: string | null,
): Promise<void> {
  if (pricingTierId === null) return;
  const tier = await transaction.pricingTier.findUnique({
    where: { id: pricingTierId },
    select: { isActive: true },
  });
  if (!tier) throw new NotFoundException('Pricing tier not found.');
  if (!tier.isActive) {
    throw companyBusinessRuleError('pricingTierId', 'Pricing tier must be active.');
  }
}

async function validateDefaultDriver(
  transaction: Prisma.TransactionClient,
  defaultDriverId: string | null,
): Promise<void> {
  if (defaultDriverId === null) return;
  const staffUser = await transaction.staffUser.findUnique({
    where: { id: defaultDriverId },
    select: {
      isActive: true,
      role: {
        select: {
          rolePermissions: {
            where: { permission: { code: { in: [...driverPermissions] } } },
            select: { permission: { select: { code: true } } },
          },
        },
      },
    },
  });
  if (!staffUser) throw new NotFoundException('Default driver not found.');
  if (!staffUser.isActive) {
    throw companyBusinessRuleError('defaultDriverId', 'Default driver must be active.');
  }
  const granted = new Set(staffUser.role.rolePermissions.map(({ permission }) => permission.code));
  if (!driverPermissions.every((permission) => granted.has(permission))) {
    throw companyBusinessRuleError(
      'defaultDriverId',
      'Default driver must have delivery permissions.',
    );
  }
}

async function validateOwnerEmployee(
  transaction: Prisma.TransactionClient,
  companyId: string,
  companyIsActive: boolean,
  currentOwnerEmployeeId: string | null,
  ownerEmployeeId: string | null,
): Promise<void> {
  if (ownerEmployeeId === null) {
    if (currentOwnerEmployeeId !== null) {
      throw companyBusinessRuleError(
        'ownerEmployeeId',
        'A Company owner must be replaced, not cleared.',
      );
    }
    return;
  }
  if (!companyIsActive) {
    throw companyBusinessRuleError('ownerEmployeeId', 'Company must be active to assign an owner.');
  }
  const employee = await transaction.employee.findUnique({
    where: { id: ownerEmployeeId },
    select: { companyId: true, isActive: true },
  });
  if (!employee) throw new NotFoundException('Owner Employee not found.');
  if (!employee.isActive || employee.companyId !== companyId) {
    throw companyBusinessRuleError(
      'ownerEmployeeId',
      'Owner must be an active Employee of this Company.',
    );
  }
  const otherOwnedCompany = await transaction.company.findFirst({
    where: { ownerEmployeeId, id: { not: companyId } },
    select: { id: true },
  });
  if (otherOwnedCompany) {
    throw companyBusinessRuleError(
      'ownerEmployeeId',
      'Employee already owns another Company.',
    );
  }
}

async function requireCompany(
  client: Prisma.TransactionClient | PrismaService,
  id: string,
): Promise<void> {
  const company = await client.company.findUnique({ where: { id }, select: { id: true } });
  if (!company) throw new NotFoundException('Company not found.');
}

async function assertCompanyHasActiveAddress(
  transaction: Prisma.TransactionClient,
  companyId: string,
): Promise<void> {
  const activeAddress = await transaction.companyAddress.findFirst({
    where: { companyId, isActive: true },
    select: { id: true },
  });
  if (!activeAddress) {
    throw companyBusinessRuleError(
      'isActive',
      'An active Company must retain at least one active address.',
    );
  }
}

function toAddressCreateData(input: CompanyAddressDto): Prisma.CompanyAddressCreateWithoutCompanyInput {
  return {
    label: input.label,
    addressLine1: input.addressLine1,
    addressLine2: input.addressLine2 ?? null,
    city: input.city,
    stateRegion: input.stateRegion,
    postalCode: input.postalCode,
    country: input.country,
  };
}

function hasCompanyUpdate(input: UpdateCompanyDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function hasAddressUpdate(input: UpdateCompanyAddressDto): boolean {
  return Object.values(input).some((value) => value !== undefined);
}

function toCompanySummaryResponse(company: {
  id: string;
  name: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  pricingTier: { id: string; name: string; derivationSource: 'BASE_TIER' | 'ITEM_COST' | null } | null;
}): CompanySummaryResponse {
  return {
    id: company.id,
    name: company.name,
    isActive: company.isActive,
    pricingTier: company.pricingTier,
    createdAt: company.createdAt.toISOString(),
    updatedAt: company.updatedAt.toISOString(),
  };
}

function toCompanyResponse(company: CompanyWithRelations): CompanyResponse {
  return {
    ...toCompanySummaryResponse(company),
    billingContact: {
      name: company.billingContactName,
      email: company.billingContactEmail,
      phone: company.billingContactPhone,
    },
    workingDays: normalizeWorkingDays(company.workingDays),
    defaultDeliveryTime: minutesToDeliveryTime(company.defaultDeliveryTimeMinutes),
    deliveryMinutesBefore: company.deliveryMinutesBefore,
    defaultPackaging: company.defaultPackaging,
    driverInstructions: company.driverInstructions,
    defaultDriver: company.defaultDriver,
    domains: company.emailDomains.map((domain) => ({
      id: domain.id,
      domain: domain.domain,
      createdAt: domain.createdAt.toISOString(),
    })),
    addresses: company.addresses.map(toAddressResponse),
    holidays: company.holidays.map(toHolidayResponse),
  };
}

function toAddressResponse(address: {
  id: string;
  label: string;
  addressLine1: string;
  addressLine2: string | null;
  city: string;
  stateRegion: string;
  postalCode: string;
  country: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}): CompanyAddressResponse {
  return {
    id: address.id,
    label: address.label,
    addressLine1: address.addressLine1,
    addressLine2: address.addressLine2,
    city: address.city,
    stateRegion: address.stateRegion,
    postalCode: address.postalCode,
    country: address.country,
    isActive: address.isActive,
    createdAt: address.createdAt.toISOString(),
    updatedAt: address.updatedAt.toISOString(),
  };
}

function toHolidayResponse(holiday: {
  id: string;
  date: Date;
  name: string | null;
  createdAt: Date;
}): CompanyHolidayResponse {
  return {
    id: holiday.id,
    date: formatHolidayDate(holiday.date),
    name: holiday.name,
    createdAt: holiday.createdAt.toISOString(),
  };
}
