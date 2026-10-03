import { DateTime } from 'luxon';

export function nowInTimeZone(timeZone: string): DateTime {
  return assertValidDateTime(DateTime.now().setZone(timeZone), timeZone);
}

export function todayInTimeZone(timeZone: string): string {
  const date = nowInTimeZone(timeZone).toISODate();

  if (!date) {
    throw new RangeError(`Could not determine today's date in ${timeZone}.`);
  }

  return date;
}

/**
 * Interprets a local calendar date and clock time in the supplied IANA zone.
 * The returned DateTime represents that instant and can be converted with
 * `toUTC()` when an absolute UTC representation is needed.
 */
export function combineLocalDateAndTime(
  localDate: string,
  localTime: string,
  timeZone: string,
): DateTime {
  return assertValidDateTime(
    DateTime.fromFormat(`${localDate} ${localTime}`, 'yyyy-MM-dd HH:mm', {
      zone: timeZone,
      setZone: true,
    }),
    timeZone,
  );
}

export function convertToTimeZone(
  instant: Date | DateTime,
  timeZone: string,
): DateTime {
  const dateTime =
    instant instanceof Date ? DateTime.fromJSDate(instant, { zone: 'utc' }) : instant;

  return assertValidDateTime(dateTime.setZone(timeZone), timeZone);
}

function assertValidDateTime(dateTime: DateTime, timeZone: string): DateTime {
  if (!dateTime.isValid) {
    throw new RangeError(
      `Invalid date, time, or IANA timezone (${timeZone}): ${dateTime.invalidExplanation ?? dateTime.invalidReason ?? 'unknown reason'}.`,
    );
  }

  return dateTime;
}
