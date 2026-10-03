/**
 * Validates a final persisted monetary amount expressed in integer minor units
 * (for example, 1299 represents $12.99).
 */
export function assertMinorUnits(value: number, field = 'amount'): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(
      `${field} must be a non-negative safe integer minor-unit amount.`,
    );
  }

  return value;
}

export function sumMinorUnits(amounts: readonly number[]): number {
  const total = amounts.reduce(
    (sum, amount) => assertMinorUnits(sum + assertMinorUnits(amount)),
    0,
  );

  return assertMinorUnits(total);
}

export function multiplyMinorUnits(unitPrice: number, quantity: number): number {
  assertMinorUnits(unitPrice, 'unitPrice');
  assertQuantity(quantity);

  return assertMinorUnits(unitPrice * quantity, 'result');
}

export function roundUpToNearestFiveCents(amount: number): number {
  assertMinorUnits(amount);

  return assertMinorUnits(Math.ceil(amount / 5) * 5);
}

const MAX_POSTGRES_INT = 2_147_483_647;
const BASIS_POINTS_SCALE = 10_000n;

/**
 * Derives a persisted selling price without floating-point arithmetic, then
 * rounds upward to the next five minor units.
 */
export function derivePriceMinorUnits(
  baseMinorUnits: number,
  multiplierBps: number,
): number {
  assertSupportedPersistedMinorUnits(baseMinorUnits, 'baseMinorUnits');
  assertMultiplierBps(multiplierBps);

  const product = BigInt(baseMinorUnits) * BigInt(multiplierBps);
  const rawPrice = divideAndRoundUp(product, BASIS_POINTS_SCALE);

  if (rawPrice > BigInt(MAX_POSTGRES_INT)) {
    throw new RangeError('Derived price exceeds the supported persisted range.');
  }

  return roundUpToNearestFiveCents(Number(rawPrice));
}

export function assertSupportedPersistedMinorUnits(
  value: number,
  field = 'amount',
): number {
  assertMinorUnits(value, field);
  if (value > MAX_POSTGRES_INT) {
    throw new RangeError(`${field} exceeds the supported persisted range.`);
  }

  return value;
}

export function assertMultiplierBps(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_POSTGRES_INT) {
    throw new RangeError('multiplierBps must be a positive supported integer.');
  }

  return value;
}

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('quantity must be a non-negative safe integer.');
  }
}

function divideAndRoundUp(numerator: bigint, denominator: bigint): bigint {
  return (numerator + denominator - 1n) / denominator;
}
