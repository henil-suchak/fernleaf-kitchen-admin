export const CUTOFF_TIME_PATTERN = /^(?:[01]\d|2[0-3]):[0-5]\d$/;

export function cutoffTimeToMinutes(cutoffTime: string): number {
  if (!CUTOFF_TIME_PATTERN.test(cutoffTime)) {
    throw new RangeError('cutoffTime must use the HH:mm format.');
  }

  const hours = Number(cutoffTime.slice(0, 2));
  const minutes = Number(cutoffTime.slice(3, 5));

  return hours * 60 + minutes;
}

export function minutesToCutoffTime(cutoffTimeMinutes: number): string {
  if (
    !Number.isInteger(cutoffTimeMinutes) ||
    cutoffTimeMinutes < 0 ||
    cutoffTimeMinutes > 23 * 60 + 59
  ) {
    throw new RangeError('cutoffTimeMinutes must be between 0 and 1439.');
  }

  const hours = Math.floor(cutoffTimeMinutes / 60);
  const minutes = cutoffTimeMinutes % 60;

  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
}
