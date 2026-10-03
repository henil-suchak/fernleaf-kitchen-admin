export interface NormalizedReferenceName {
  name: string;
  normalizedName: string;
}

export function normalizeReferenceName(value: string): NormalizedReferenceName {
  const name = value.trim().replace(/\s+/g, ' ');

  if (!name) {
    throw new RangeError('name must not be blank.');
  }

  return {
    name,
    normalizedName: name.toLowerCase(),
  };
}
