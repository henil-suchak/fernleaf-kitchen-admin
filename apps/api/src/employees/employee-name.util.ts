export function normalizeEmployeeName(value: string): string {
  const name = value.trim().replace(/\s+/g, ' ');
  if (!name) throw new RangeError('name must not be blank.');
  return name;
}

export function normalizeEmployeeEmail(value: string): string {
  const email = value.trim().toLowerCase();
  if (!email) throw new RangeError('email must not be blank.');
  return email;
}
