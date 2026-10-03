import {
  DishTemperature,
  KitchenSettingsKey,
  PrismaClient,
  Weekday,
} from '@prisma/client';
import bcrypt from 'bcrypt';

import {
  PermissionCode,
  permissionDescriptions,
} from '../src/authorization/permission-code';
import { normalizeReferenceName } from '../src/reference-data/reference-name.util';
import {
  normalizeCatalogueName,
  normalizeSku,
} from '../src/catalogue/catalogue-name.util';

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

const referenceData = {
  allergens: ['Milk', 'Eggs', 'Peanuts', 'Tree Nuts', 'Gluten', 'Soy'],
  dietaryTags: ['Vegetarian', 'Vegan', 'Halal', 'High Protein'],
  kitchenStations: ['Hot Kitchen', 'Grill', 'Cold Prep', 'Salad'],
} as const;

const catalogueData = {
  options: [
    'Jeera Rice',
    'Brown Rice',
    'Basmati Rice',
    'Mint Sauce',
    'Spicy Mayo',
    'Extra Paneer',
    'Extra Cheese',
  ],
  optionGroups: ['Choose Rice', 'Choose Sauce', 'Extra Topping'],
} as const;

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

  for (const value of referenceData.allergens) {
    const normalized = normalizeReferenceName(value);

    await prisma.allergen.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: normalized,
    });
  }

  for (const value of referenceData.dietaryTags) {
    const normalized = normalizeReferenceName(value);

    await prisma.dietaryTag.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: normalized,
    });
  }

  for (const value of referenceData.kitchenStations) {
    const normalized = normalizeReferenceName(value);

    await prisma.kitchenStation.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: normalized,
    });
  }

  await seedCatalogue();
}

async function seedCatalogue(): Promise<void> {
  const optionIds = new Map<string, string>();
  for (const value of catalogueData.options) {
    const normalized = normalizeCatalogueName(value);
    const option = await prisma.option.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: normalized,
    });
    optionIds.set(normalized.normalizedName, option.id);
  }

  const optionGroupIds = new Map<string, string>();
  for (const value of catalogueData.optionGroups) {
    const normalized = normalizeCatalogueName(value);
    const optionGroup = await prisma.optionGroup.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: normalized,
    });
    optionGroupIds.set(normalized.normalizedName, optionGroup.id);
  }

  await addOptionMembership(
    optionGroupIds,
    optionIds,
    'choose rice',
    ['jeera rice', 'brown rice', 'basmati rice'],
  );
  await addOptionMembership(
    optionGroupIds,
    optionIds,
    'choose sauce',
    ['mint sauce', 'spicy mayo'],
  );
  await addOptionMembership(
    optionGroupIds,
    optionIds,
    'extra topping',
    ['extra paneer', 'extra cheese'],
  );

  const hotKitchen = await getKitchenStation('Hot Kitchen');
  const saladStation = await getKitchenStation('Salad');
  const milk = await getAllergen('Milk');
  const gluten = await getAllergen('Gluten');
  const vegetarian = await getDietaryTag('Vegetarian');
  const highProtein = await getDietaryTag('High Protein');

  const paneerPowerBowl = await prisma.dish.upsert({
    where: { sku: normalizeSku('PPB-001') },
    update: {},
    create: {
      name: 'Paneer Power Bowl',
      description: 'Grilled paneer with rice and vegetables.',
      sku: normalizeSku('PPB-001'),
      temperature: DishTemperature.HOT,
      costMinorUnits: 10000,
      minimumQuantity: 1,
      kitchenStationId: hotKitchen.id,
    },
  });

  const paneerGardenSalad = await prisma.dish.upsert({
    where: { sku: normalizeSku('PGS-001') },
    update: {},
    create: {
      name: 'Paneer Garden Salad',
      description: 'Fresh greens with grilled paneer and vegetables.',
      sku: normalizeSku('PGS-001'),
      temperature: DishTemperature.COLD,
      costMinorUnits: 9000,
      minimumQuantity: 1,
      kitchenStationId: saladStation.id,
    },
  });

  await addDishReference(paneerPowerBowl.id, milk.id, 'allergen');
  await addDishReference(paneerPowerBowl.id, gluten.id, 'allergen');
  await addDishReference(paneerPowerBowl.id, vegetarian.id, 'dietaryTag');
  await addDishReference(paneerPowerBowl.id, highProtein.id, 'dietaryTag');
  await addDishReference(paneerGardenSalad.id, milk.id, 'allergen');
  await addDishReference(paneerGardenSalad.id, vegetarian.id, 'dietaryTag');
  await addDishReference(paneerGardenSalad.id, highProtein.id, 'dietaryTag');

  await addDishOptionGroups(paneerPowerBowl.id, optionGroupIds, [
    { group: 'choose rice', isRequired: true, sortOrder: 1 },
    { group: 'choose sauce', isRequired: false, sortOrder: 2 },
    { group: 'extra topping', isRequired: false, sortOrder: 3 },
  ]);
  await addDishOptionGroups(paneerGardenSalad.id, optionGroupIds, [
    { group: 'choose sauce', isRequired: false, sortOrder: 1 },
    { group: 'extra topping', isRequired: false, sortOrder: 2 },
  ]);
}

async function addOptionMembership(
  optionGroupIds: Map<string, string>,
  optionIds: Map<string, string>,
  groupName: string,
  optionNames: readonly string[],
): Promise<void> {
  const optionGroupId = requiredValue(
    optionGroupIds.get(groupName),
    `option group ${groupName}`,
  );

  for (const [index, optionName] of optionNames.entries()) {
    const optionId = requiredValue(optionIds.get(optionName), `option ${optionName}`);
    await prisma.optionGroupOption.upsert({
      where: { optionGroupId_optionId: { optionGroupId, optionId } },
      update: {},
      create: { optionGroupId, optionId, sortOrder: index + 1 },
    });
  }
}

async function addDishReference(
  dishId: string,
  referenceId: string,
  kind: 'allergen' | 'dietaryTag',
): Promise<void> {
  if (kind === 'allergen') {
    await prisma.dishAllergen.upsert({
      where: { dishId_allergenId: { dishId, allergenId: referenceId } },
      update: {},
      create: { dishId, allergenId: referenceId },
    });
    return;
  }

  await prisma.dishDietaryTag.upsert({
    where: { dishId_dietaryTagId: { dishId, dietaryTagId: referenceId } },
    update: {},
    create: { dishId, dietaryTagId: referenceId },
  });
}

async function addDishOptionGroups(
  dishId: string,
  optionGroupIds: Map<string, string>,
  groups: ReadonlyArray<{
    group: string;
    isRequired: boolean;
    sortOrder: number;
  }>,
): Promise<void> {
  for (const group of groups) {
    const optionGroupId = requiredValue(
      optionGroupIds.get(group.group),
      `option group ${group.group}`,
    );
    await prisma.dishOptionGroup.upsert({
      where: { dishId_optionGroupId: { dishId, optionGroupId } },
      update: {},
      create: {
        dishId,
        optionGroupId,
        isRequired: group.isRequired,
        sortOrder: group.sortOrder,
      },
    });
  }
}

async function getKitchenStation(name: string) {
  const normalizedName = normalizeReferenceName(name).normalizedName;
  const station = await prisma.kitchenStation.findUnique({
    where: { normalizedName },
  });
  return requiredValue(station, `kitchen station ${name}`);
}

async function getAllergen(name: string) {
  const normalizedName = normalizeReferenceName(name).normalizedName;
  const allergen = await prisma.allergen.findUnique({ where: { normalizedName } });
  return requiredValue(allergen, `allergen ${name}`);
}

async function getDietaryTag(name: string) {
  const normalizedName = normalizeReferenceName(name).normalizedName;
  const dietaryTag = await prisma.dietaryTag.findUnique({
    where: { normalizedName },
  });
  return requiredValue(dietaryTag, `dietary tag ${name}`);
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
    console.log('Identity, settings, reference data, and catalogue seed completed.');
  })
  .catch((error: unknown) => {
    console.error('Application seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
