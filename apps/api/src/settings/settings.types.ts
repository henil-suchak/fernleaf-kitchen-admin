import type { Weekday } from '@prisma/client';

export const WEEKDAY_ORDER: readonly Weekday[] = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
];

export interface KitchenSettingsResponse {
  timezone: string;
  workingDays: Weekday[];
  cutoffWorkingDays: number;
  cutoffTime: string;
  updatedAt: string;
}

export interface KitchenHolidayResponse {
  id: string;
  date: string;
  name: string | null;
  createdAt: string;
}
