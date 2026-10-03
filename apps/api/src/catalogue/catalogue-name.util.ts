export interface NormalizedCatalogueName {
  name: string;
  normalizedName: string;
}

export function normalizeCatalogueName(value: string): NormalizedCatalogueName {
  const name = normalizeDisplayName(value);

  return {
    name,
    normalizedName: name.toLowerCase(),
  };
}

export function normalizeDisplayName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');

  if (!name) {
    throw new RangeError('name must not be blank.');
  }

  return name;
}

export function normalizeSku(value: string): string {
  const sku = value.trim().toUpperCase();

  if (!sku) {
    throw new RangeError('sku must not be blank.');
  }

  return sku;
}
