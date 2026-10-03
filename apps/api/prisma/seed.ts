import {
  DishTemperature,
  KitchenSettingsKey,
  PrismaClient,
  PricingDerivationSource,
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
    { name: 'Jeera Rice', costMinorUnits: 500, dietaryTags: ['Vegan', 'Halal'] },
    { name: 'Brown Rice', costMinorUnits: 600, dietaryTags: ['Vegan', 'Halal'] },
    { name: 'Basmati Rice', costMinorUnits: 550, dietaryTags: ['Vegan', 'Halal'] },
    { name: 'Mint Sauce', costMinorUnits: 300, dietaryTags: ['Vegan', 'Halal'] },
    {
      name: 'Spicy Mayo',
      costMinorUnits: 400,
      allergens: ['Eggs'],
      dietaryTags: ['Vegetarian'],
    },
    {
      name: 'Extra Paneer',
      costMinorUnits: 2500,
      allergens: ['Milk'],
      dietaryTags: ['Vegetarian', 'High Protein'],
    },
    {
      name: 'Extra Cheese',
      costMinorUnits: 1800,
      allergens: ['Milk'],
      dietaryTags: ['Vegetarian'],
    },
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
  await seedPricing();
}

async function seedCatalogue(): Promise<void> {
  const optionIds = new Map<string, string>();
  for (const value of catalogueData.options) {
    const normalized = normalizeCatalogueName(value.name);
    const option = await prisma.option.upsert({
      where: { normalizedName: normalized.normalizedName },
      update: {},
      create: { ...normalized, costMinorUnits: value.costMinorUnits },
    });
    optionIds.set(normalized.normalizedName, option.id);
  }

  for (const value of catalogueData.options) {
    const optionName = normalizeCatalogueName(value.name).normalizedName;
    const optionId = requiredValue(optionIds.get(optionName), `option ${value.name}`);
    for (const allergenName of value.allergens ?? []) {
      await addOptionReference(optionId, (await getAllergen(allergenName)).id, 'allergen');
    }
    for (const dietaryTagName of value.dietaryTags ?? []) {
      await addOptionReference(
        optionId,
        (await getDietaryTag(dietaryTagName)).id,
        'dietaryTag',
      );
    }
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

async function seedPricing(): Promise<void> {
  const existingDefault = await prisma.pricingTier.findFirst({
    where: { isDefault: true },
    select: { id: true },
  });
  const standardName = normalizeCatalogueName('Standard');
  const standard = await prisma.pricingTier.upsert({
    where: { normalizedName: standardName.normalizedName },
    update: {},
    create: {
      ...standardName,
      isDefault: existingDefault === null,
      isActive: true,
    },
  });

  const premiumName = normalizeCatalogueName('Premium');
  await prisma.pricingTier.upsert({
    where: { normalizedName: premiumName.normalizedName },
    update: {},
    create: {
      ...premiumName,
      isActive: true,
      derivationSource: PricingDerivationSource.BASE_TIER,
      baseTierId: standard.id,
      multiplierBps: 11_500,
    },
  });

  await addStandardDishPrice(standard.id, 'PPB-001', 20_000);
  await addStandardDishPrice(standard.id, 'PGS-001', 18_000);
  await addStandardOptionPrice(standard.id, 'Jeera Rice', 0);
  await addStandardOptionPrice(standard.id, 'Brown Rice', 1_000);
  await addStandardOptionPrice(standard.id, 'Basmati Rice', 1_500);
  await addStandardOptionPrice(standard.id, 'Mint Sauce', 0);
  await addStandardOptionPrice(standard.id, 'Spicy Mayo', 500);
  await addStandardOptionPrice(standard.id, 'Extra Paneer', 4_000);
  await addStandardOptionPrice(standard.id, 'Extra Cheese', 3_000);
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

async function addOptionReference(
  optionId: string,
  referenceId: string,
  kind: 'allergen' | 'dietaryTag',
): Promise<void> {
  if (kind === 'allergen') {
    await prisma.optionAllergen.upsert({
      where: { optionId_allergenId: { optionId, allergenId: referenceId } },
      update: {},
      create: { optionId, allergenId: referenceId },
    });
    return;
  }

  await prisma.optionDietaryTag.upsert({
    where: { optionId_dietaryTagId: { optionId, dietaryTagId: referenceId } },
    update: {},
    create: { optionId, dietaryTagId: referenceId },
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

async function addStandardDishPrice(
  pricingTierId: string,
  sku: string,
  explicitPriceMinorUnits: number,
): Promise<void> {
  const dish = await prisma.dish.findUnique({
    where: { sku: normalizeSku(sku) },
    select: { id: true },
  });
  const dishId = requiredValue(dish, `dish ${sku}`).id;
  await prisma.dishTierPrice.upsert({
    where: { pricingTierId_dishId: { pricingTierId, dishId } },
    update: {},
    create: { pricingTierId, dishId, explicitPriceMinorUnits },
  });
}

async function addStandardOptionPrice(
  pricingTierId: string,
  name: string,
  explicitPriceMinorUnits: number,
): Promise<void> {
  const normalizedName = normalizeCatalogueName(name).normalizedName;
  const option = await prisma.option.findUnique({
    where: { normalizedName },
    select: { id: true },
  });
  const optionId = requiredValue(option, `option ${name}`).id;
  await prisma.optionTierPrice.upsert({
    where: { pricingTierId_optionId: { pricingTierId, optionId } },
    update: {},
    create: { pricingTierId, optionId, explicitPriceMinorUnits },
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
    console.log('Identity, settings, reference data, catalogue, and pricing seed completed.');
  })
  .catch((error: unknown) => {
    console.error('Application seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
