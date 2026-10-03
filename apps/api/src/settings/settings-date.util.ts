import { DateTime } from 'luxon';

const HOLIDAY_DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export function parseHolidayDate(date: string): Date {
  if (!HOLIDAY_DATE_PATTERN.test(date)) {
    throw new RangeError('date must use the YYYY-MM-DD format.');
  }

  const parsed = DateTime.fromFormat(date, 'yyyy-MM-dd', {
    zone: 'utc',
    locale: 'en-US',
  });

  if (!parsed.isValid || parsed.toFormat('yyyy-MM-dd') !== date) {
    throw new RangeError('date must be a valid calendar date.');
  }

  return parsed.toJSDate();
}

export function formatHolidayDate(date: Date): string {
  const formatted = DateTime.fromJSDate(date, { zone: 'utc' }).toISODate();

  if (!formatted) {
    throw new RangeError('Could not format a kitchen holiday date.');
  }

  return formatted;
}
