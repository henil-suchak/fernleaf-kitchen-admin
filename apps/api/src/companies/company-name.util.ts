export interface NormalizedCompanyName {
  name: string;
  normalizedName: string;
}

export function normalizeCompanyName(value: string): NormalizedCompanyName {
  const name = value.trim().replace(/\s+/g, ' ');

  if (!name) throw new RangeError('name must not be blank.');

  return { name, normalizedName: name.toLowerCase() };
}
