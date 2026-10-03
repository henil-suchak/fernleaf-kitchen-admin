const PUBLIC_DOMAINS = new Set([
  'gmail.com',
  'googlemail.com',
  'yahoo.com',
  'outlook.com',
  'hotmail.com',
  'live.com',
  'icloud.com',
  'proton.me',
  'protonmail.com',
]);

const DOMAIN_PATTERN = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

export function normalizeCompanyDomain(value: string): string {
  const domain = value.trim().toLowerCase();

  if (!DOMAIN_PATTERN.test(domain)) {
    throw new RangeError('domain must be a valid domain name without a protocol, path, wildcard, or email address.');
  }
  if (PUBLIC_DOMAINS.has(domain)) {
    throw new RangeError('public email domains cannot be assigned to a Company.');
  }

  return domain;
}
