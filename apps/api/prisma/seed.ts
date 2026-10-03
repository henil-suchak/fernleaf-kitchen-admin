import {
  KitchenSettingsKey,
  PrismaClient,
  Weekday,
} from '@prisma/client';
import bcrypt from 'bcrypt';

import {
  PermissionCode,
  permissionDescriptions,
} from '../src/authorization/permission-code';

const prisma = new PrismaClient();

const permissions = Object.entries(permissionDescriptions) as [
  PermissionCode,
  string,
][];
type RoleCode = 'ADMIN' | 'KITCHEN' | 'DISPATCH' | 'DRIVER';

const roles: ReadonlyArray<{ code: RoleCode; name: string }> = [
  { code: 'ADMIN', name: 'Administrator' },
  { code: 'KITCHEN', name: 'Kitchen' },
  { code: 'DISPATCH', name: 'Dispatch' },
  { code: 'DRIVER', name: 'Driver' },
];

const permissionsByRole: Record<RoleCode, readonly PermissionCode[]> = {
  ADMIN: Object.values(PermissionCode),
  KITCHEN: [
    PermissionCode.ORDER_READ,
    PermissionCode.KITCHEN_READ,
    PermissionCode.KITCHEN_UPDATE,
  ],
  DISPATCH: [
    PermissionCode.ORDER_READ,
    PermissionCode.DISPATCH_READ,
    PermissionCode.DISPATCH_UPDATE,
  ],
  DRIVER: [
    PermissionCode.DELIVERY_OWN_READ,
    PermissionCode.DELIVERY_OWN_UPDATE,
  ],
};

const staffAccounts: ReadonlyArray<{ email: string; roleCode: RoleCode }> = [
  { email: 'admin@test.com', roleCode: 'ADMIN' },
  { email: 'kitchen@test.com', roleCode: 'KITCHEN' },
  { email: 'dispatch@test.com', roleCode: 'DISPATCH' },
  { email: 'driver@test.com', roleCode: 'DRIVER' },
];

const defaultKitchenSettings = {
  timezone: 'Asia/Kolkata',
  workingDays: [
    Weekday.MONDAY,
    Weekday.TUESDAY,
    Weekday.WEDNESDAY,
    Weekday.THURSDAY,
    Weekday.FRIDAY,
  ],
  cutoffWorkingDays: 2,
  cutoffTimeMinutes: 16 * 60,
};

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

  await prisma.kitchenSettings.upsert({
    where: { key: KitchenSettingsKey.GLOBAL },
    update: {},
    create: {
      key: KitchenSettingsKey.GLOBAL,
      ...defaultKitchenSettings,
    },
  });
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
    console.log('Identity and settings seed completed.');
  })
  .catch((error: unknown) => {
    console.error('Identity seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
