import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  KitchenSettingsKey,
  Prisma,
  type KitchenHoliday,
  type KitchenSettings,
  type Weekday,
} from '@prisma/client';
import type { PaginatedResponse } from '@fernleaf/contracts';

import { ApiErrorCode } from '../common/errors/api-error-code';
import {
  createPaginatedResponse,
  toPaginationOptions,
} from '../common/pagination/pagination.util';
import type { PaginationInput } from '../common/pagination/pagination.types';
import { nowInTimeZone } from '../common/time/time.util';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateKitchenHolidayDto } from './dto/create-kitchen-holiday.dto';
import type { UpdateKitchenSettingsDto } from './dto/update-kitchen-settings.dto';
import { formatHolidayDate, parseHolidayDate } from './settings-date.util';
import { cutoffTimeToMinutes, minutesToCutoffTime } from './settings-time.util';
import {
  WEEKDAY_ORDER,
  type KitchenHolidayResponse,
  type KitchenSettingsResponse,
} from './settings.types';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaService) {}

  async getKitchenSettings(): Promise<KitchenSettingsResponse> {
    const settings = await this.prisma.kitchenSettings.findUnique({
      where: { key: KitchenSettingsKey.GLOBAL },
    });

    if (!settings) {
      throw new Error('The global kitchen settings record is missing. Run the seed.');
    }

    return toKitchenSettingsResponse(settings);
  }

  async updateKitchenSettings(
    update: UpdateKitchenSettingsDto,
  ): Promise<KitchenSettingsResponse> {
    if (!hasSettingsUpdate(update)) {
      throw validationError(
        'settings',
        'At least one kitchen settings field must be provided.',
      );
    }

    const data: Prisma.KitchenSettingsUpdateInput = {};

    if (update.timezone !== undefined) {
      data.timezone = validateTimezone(update.timezone);
    }

    if (update.workingDays !== undefined) {
      data.workingDays = { set: normalizeWorkingDays(update.workingDays) };
    }

    if (update.cutoffWorkingDays !== undefined) {
      data.cutoffWorkingDays = update.cutoffWorkingDays;
    }

    if (update.cutoffTime !== undefined) {
      data.cutoffTimeMinutes = cutoffTimeToMinutes(update.cutoffTime);
    }

    const settings = await this.prisma.kitchenSettings.update({
      where: { key: KitchenSettingsKey.GLOBAL },
      data,
    });

    return toKitchenSettingsResponse(settings);
  }

  async listKitchenHolidays(
    pagination: PaginationInput,
  ): Promise<PaginatedResponse<KitchenHolidayResponse>> {
    const { skip, take } = toPaginationOptions(pagination);
    const [holidays, total] = await this.prisma.$transaction([
      this.prisma.kitchenHoliday.findMany({
        orderBy: { date: 'asc' },
        skip,
        take,
      }),
      this.prisma.kitchenHoliday.count(),
    ]);

    return createPaginatedResponse(
      holidays.map(toKitchenHolidayResponse),
      total,
      pagination,
    );
  }

  async addKitchenHoliday(
    input: CreateKitchenHolidayDto,
  ): Promise<KitchenHolidayResponse> {
    let date: Date;

    try {
      date = parseHolidayDate(input.date);
    } catch {
      throw validationError('date', 'date must be a valid calendar date.');
    }

    try {
      const holiday = await this.prisma.kitchenHoliday.create({
        data: {
          date,
          name: input.name,
        },
      });

      return toKitchenHolidayResponse(holiday);
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2002')) {
        throw new ConflictException('A kitchen holiday already exists for this date.');
      }

      throw error;
    }
  }

  async removeKitchenHoliday(id: string): Promise<void> {
    try {
      await this.prisma.kitchenHoliday.delete({ where: { id } });
    } catch (error: unknown) {
      if (isPrismaError(error, 'P2025')) {
        throw new NotFoundException('Kitchen holiday not found.');
      }

      throw error;
    }
  }
}

function hasSettingsUpdate(update: UpdateKitchenSettingsDto): boolean {
  return (
    update.timezone !== undefined ||
    update.workingDays !== undefined ||
    update.cutoffWorkingDays !== undefined ||
    update.cutoffTime !== undefined
  );
}

function validateTimezone(timezone: string): string {
  try {
    nowInTimeZone(timezone);
    return timezone;
  } catch {
    throw validationError('timezone', 'timezone must be a valid IANA timezone.');
  }
}

function normalizeWorkingDays(workingDays: readonly Weekday[]): Weekday[] {
  if (workingDays.length === 0) {
    throw validationError('workingDays', 'workingDays must contain at least one day.');
  }

  if (new Set(workingDays).size !== workingDays.length) {
    throw validationError('workingDays', 'workingDays must not contain duplicates.');
  }

  return WEEKDAY_ORDER.filter((weekday) => workingDays.includes(weekday));
}

function toKitchenSettingsResponse(
  settings: KitchenSettings,
): KitchenSettingsResponse {
  return {
    timezone: settings.timezone,
    workingDays: normalizeWorkingDays(settings.workingDays),
    cutoffWorkingDays: settings.cutoffWorkingDays,
    cutoffTime: minutesToCutoffTime(settings.cutoffTimeMinutes),
    updatedAt: settings.updatedAt.toISOString(),
  };
}

function toKitchenHolidayResponse(
  holiday: KitchenHoliday,
): KitchenHolidayResponse {
  return {
    id: holiday.id,
    date: formatHolidayDate(holiday.date),
    name: holiday.name,
    createdAt: holiday.createdAt.toISOString(),
  };
}

function validationError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_ERROR,
    message: 'Some fields are invalid',
    details: [{ field, message }],
  });
}

function isPrismaError(error: unknown, code: string): boolean {
  return (
    error instanceof Prisma.PrismaClientKnownRequestError && error.code === code
  );
}
