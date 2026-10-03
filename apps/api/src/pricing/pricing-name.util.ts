export interface NormalizedPricingName {
  name: string;
  normalizedName: string;
}

export function normalizePricingName(value: string): NormalizedPricingName {
  const name = value.trim().replace(/\s+/g, ' ');
  if (name.length === 0) {
    throw new RangeError('Pricing tier name must not be empty.');
  }

  return { name, normalizedName: name.toLocaleLowerCase() };
}
