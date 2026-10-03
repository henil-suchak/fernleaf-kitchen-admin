import { PrismaClient } from '@prisma/client';
import bcrypt from 'bcrypt';

const prisma = new PrismaClient();

const permissions = [
  ['STAFF_MANAGE', 'Manage internal staff users and roles.'],
  ['SETTINGS_READ', 'View platform settings.'],
  ['SETTINGS_WRITE', 'Change platform settings.'],
  ['CATALOGUE_READ', 'View catalogue data.'],
  ['CATALOGUE_WRITE', 'Manage catalogue data.'],
  ['PRICING_READ', 'View pricing data.'],
  ['PRICING_WRITE', 'Manage pricing data.'],
  ['COMPANY_READ', 'View company data.'],
  ['COMPANY_WRITE', 'Manage company data.'],
  ['EMPLOYEE_READ', 'View customer employee data.'],
  ['EMPLOYEE_WRITE', 'Manage customer employee data.'],
  ['MENU_READ', 'View menus.'],
  ['MENU_WRITE', 'Manage menus.'],
  ['ORDER_READ', 'View orders.'],
  ['ORDER_CREATE', 'Create orders.'],
  ['ORDER_EDIT', 'Edit orders before the cut-off.'],
  ['ORDER_OVERRIDE', 'Override order restrictions.'],
  ['KITCHEN_READ', 'View kitchen work.'],
  ['KITCHEN_UPDATE', 'Update kitchen work.'],
  ['DISPATCH_READ', 'View dispatch work.'],
  ['DISPATCH_UPDATE', 'Update dispatch work.'],
  ['DELIVERY_OWN_READ', 'View deliveries assigned to the current driver.'],
  ['DELIVERY_OWN_UPDATE', 'Update deliveries assigned to the current driver.'],
  ['BILLING_READ', 'View company billing.'],
  ['BILLING_WRITE', 'Manage company billing.'],
] as const;

type PermissionCode = (typeof permissions)[number][0];
type RoleCode = 'ADMIN' | 'KITCHEN' | 'DISPATCH' | 'DRIVER';

const roles: ReadonlyArray<{ code: RoleCode; name: string }> = [
  { code: 'ADMIN', name: 'Administrator' },
  { code: 'KITCHEN', name: 'Kitchen' },
  { code: 'DISPATCH', name: 'Dispatch' },
  { code: 'DRIVER', name: 'Driver' },
];

const permissionsByRole: Record<RoleCode, readonly PermissionCode[]> = {
  ADMIN: permissions.map(([code]) => code),
  KITCHEN: ['ORDER_READ', 'KITCHEN_READ', 'KITCHEN_UPDATE'],
  DISPATCH: ['ORDER_READ', 'DISPATCH_READ', 'DISPATCH_UPDATE'],
  DRIVER: ['DELIVERY_OWN_READ', 'DELIVERY_OWN_UPDATE'],
};

const staffAccounts: ReadonlyArray<{ email: string; roleCode: RoleCode }> = [
  { email: 'admin@test.com', roleCode: 'ADMIN' },
  { email: 'kitchen@test.com', roleCode: 'KITCHEN' },
  { email: 'dispatch@test.com', roleCode: 'DISPATCH' },
  { email: 'driver@test.com', roleCode: 'DRIVER' },
];

async function seed(): Promise<void> {
  const permissionsByCode = new Map<string, string>();

  for (const [code, description] of permissions) {
    const permission = await prisma.permission.upsert({
      where: { code },
      update: { description },
      create: { code, description },
    });
    permissionsByCode.set(code, permission.id);
  }

  const rolesByCode = new Map<RoleCode, string>();

  for (const { code, name } of roles) {
    const role = await prisma.role.upsert({
      where: { code },
      update: { name },
      create: { code, name },
    });
    rolesByCode.set(code, role.id);
  }

  for (const [roleCode, permissionCodes] of Object.entries(permissionsByRole) as [
    RoleCode,
    readonly PermissionCode[],
  ][]) {
    const roleId = requiredValue(rolesByCode.get(roleCode), `role ${roleCode}`);

    for (const permissionCode of permissionCodes) {
      const permissionId = requiredValue(
        permissionsByCode.get(permissionCode),
        `permission ${permissionCode}`,
      );

      await prisma.rolePermission.upsert({
        where: { roleId_permissionId: { roleId, permissionId } },
        update: {},
        create: { roleId, permissionId },
      });
    }
  }

  const passwordHash = await bcrypt.hash('Test@1234', 12);

  for (const { email, roleCode } of staffAccounts) {
    const roleId = requiredValue(rolesByCode.get(roleCode), `role ${roleCode}`);

    await prisma.staffUser.upsert({
      where: { email: normalizeEmail(email) },
      update: { isActive: true, passwordHash, roleId },
      create: {
        email: normalizeEmail(email),
        passwordHash,
        roleId,
      },
    });
  }
}

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function requiredValue<T>(value: T | undefined, label: string): T {
  if (value === undefined) {
    throw new Error(`Missing seeded ${label}.`);
  }

  return value;
}

seed()
  .then(() => {
    console.log('Identity seed completed.');
  })
  .catch((error: unknown) => {
    console.error('Identity seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
