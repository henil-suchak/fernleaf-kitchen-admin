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

function assertQuantity(quantity: number): void {
  if (!Number.isSafeInteger(quantity) || quantity < 0) {
    throw new RangeError('quantity must be a non-negative safe integer.');
  }
}
