import {
  DishTemperature,
  KitchenSettingsKey,
  OrderStatus,
  PrismaClient,
  PricingDerivationSource,
  Weekday,
} from '@prisma/client';
import bcrypt from 'bcrypt';
import { DateTime } from 'luxon';

import {
  PermissionCode,
  permissionDescriptions,
} from '../src/authorization/permission-code';
import { normalizeReferenceName } from '../src/reference-data/reference-name.util';
import {
  normalizeCatalogueName,
  normalizeSku,
} from '../src/catalogue/catalogue-name.util';
import { normalizeCompanyDomain } from '../src/companies/company-domain.util';
import { normalizeCompanyName } from '../src/companies/company-name.util';

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
  await seedCompanies();
  await seedEmployees();
  await seedMenu();
  await seedOrders();
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

async function seedCompanies(): Promise<void> {
  const [standard, premium, driver] = await Promise.all([
    prisma.pricingTier.findUniqueOrThrow({ where: { normalizedName: 'standard' } }),
    prisma.pricingTier.findUniqueOrThrow({ where: { normalizedName: 'premium' } }),
    prisma.staffUser.findUniqueOrThrow({ where: { email: 'driver@test.com' } }),
  ]);

  await seedCompany({
    name: 'Acme Technologies',
    domains: ['acme.com', 'acme.in'],
    billingContactName: 'Acme Accounts',
    billingContactEmail: 'accounts@acme.com',
    pricingTierId: premium.id,
    defaultDriverId: driver.id,
    deliveryTimeMinutes: 12 * 60 + 30,
    deliveryMinutesBefore: 60,
    defaultPackaging: 'Standard boxed meal',
    driverInstructions: 'Deliver at reception.',
    addresses: [
      {
        label: 'Ahmedabad Office',
        addressLine1: '1 Commerce Road',
        city: 'Ahmedabad',
        stateRegion: 'Gujarat',
        postalCode: '380009',
        country: 'India',
      },
    ],
  });

  await seedCompany({
    name: 'Northstar Consulting',
    domains: ['northstarconsulting.com'],
    billingContactName: 'Northstar Finance',
    billingContactEmail: 'finance@northstarconsulting.com',
    pricingTierId: standard.id,
    defaultDriverId: driver.id,
    deliveryTimeMinutes: 13 * 60,
    deliveryMinutesBefore: 60,
    defaultPackaging: 'Standard boxed meal',
    driverInstructions: 'Call the office desk on arrival.',
    addresses: [
      {
        label: 'Vadodara Office',
        addressLine1: '44 Sayajigunj Main Road',
        city: 'Vadodara',
        stateRegion: 'Gujarat',
        postalCode: '390005',
        country: 'India',
      },
    ],
  });
}

async function seedEmployees(): Promise<void> {
  const [acme, northstar, milk, eggs, vegetarian, vegan] = await Promise.all([
    findSeedCompany('acme.com'),
    findSeedCompany('northstarconsulting.com'),
    getAllergen('Milk'),
    getAllergen('Eggs'),
    getDietaryTag('Vegetarian'),
    getDietaryTag('Vegan'),
  ]);

  const [acmeOwner] = await Promise.all([
    seedEmployee({
      companyId: acme.id,
      name: 'Rahul Shah',
      email: 'rahul@acme.com',
      phone: '+91 98765 43210',
      canChooseDeliveryAddress: true,
      canChangePackaging: true,
      allergenIds: [milk.id],
      dietaryTagIds: [vegetarian.id],
    }),
    seedEmployee({
      companyId: acme.id,
      name: 'Sneha Patel',
      email: 'sneha@acme.com',
      canChangeDeliveryTime: true,
      allergenIds: [eggs.id],
      dietaryTagIds: [vegan.id],
    }),
  ]);

  const [northstarOwner] = await Promise.all([
    seedEmployee({
      companyId: northstar.id,
      name: 'Maya Desai',
      email: 'maya@northstarconsulting.com',
      canChooseDeliveryAddress: true,
      canChangeDeliveryTime: true,
      allergenIds: [milk.id],
      dietaryTagIds: [vegetarian.id],
    }),
    seedEmployee({
      companyId: northstar.id,
      name: 'Kunal Mehta',
      email: 'kunal@northstarconsulting.com',
      canChangePackaging: true,
      allergenIds: [eggs.id],
      dietaryTagIds: [vegan.id],
    }),
  ]);

  await Promise.all([
    prisma.company.updateMany({
      where: { id: acme.id, ownerEmployeeId: null },
      data: { ownerEmployeeId: acmeOwner.id },
    }),
    prisma.company.updateMany({
      where: { id: northstar.id, ownerEmployeeId: null },
      data: { ownerEmployeeId: northstarOwner.id },
    }),
  ]);
}

async function seedMenu(): Promise<void> {
  const [paneerPowerBowl, paneerGardenSalad, acme] = await Promise.all([
    prisma.dish.findUniqueOrThrow({ where: { sku: normalizeSku('PPB-001') } }),
    prisma.dish.findUniqueOrThrow({ where: { sku: normalizeSku('PGS-001') } }),
    findSeedCompany('acme.com'),
  ]);
  const bowls = await seedMenuCategory('Bowls', 1, false);
  const salads = await seedMenuCategory('Salads', 2, false);
  const chefSpecials = await seedMenuCategory('Chef Specials', 3, true);
  const [, saladItem] = await Promise.all([
    seedMenuItem(bowls.id, paneerPowerBowl.id, 1),
    seedMenuItem(salads.id, paneerGardenSalad.id, 1),
  ]);
  await seedMenuItem(chefSpecials.id, paneerPowerBowl.id, 1);
  await prisma.companyHiddenMenuItem.upsert({
    where: { companyId_menuCategoryItemId: { companyId: acme.id, menuCategoryItemId: saladItem.id } },
    update: {},
    create: { companyId: acme.id, menuCategoryItemId: saladItem.id },
  });
}

const seededOrderIds: Record<OrderStatus, string> = {
  DRAFT: '00000000-0000-4000-8000-000000000081',
  PLACED: '00000000-0000-4000-8000-000000000082',
  CONFIRMED: '00000000-0000-4000-8000-000000000083',
  DELIVERED: '00000000-0000-4000-8000-000000000084',
  CANCELLED: '00000000-0000-4000-8000-000000000085',
  REJECTED: '00000000-0000-4000-8000-000000000086',
};

async function seedOrders(): Promise<void> {
  const settings = await prisma.kitchenSettings.findUniqueOrThrow({ where: { key: KitchenSettingsKey.GLOBAL } });
  const company = await prisma.companyEmailDomain.findUniqueOrThrow({
    where: { domain: normalizeCompanyDomain('northstarconsulting.com') },
    select: { company: { select: { id: true, defaultDeliveryTimeMinutes: true, deliveryMinutesBefore: true, defaultPackaging: true, driverInstructions: true } } },
  }).then(({ company: value }) => value);
  const [employee, dish, riceGroup, brownRice, address, tier] = await Promise.all([
    prisma.employee.findUniqueOrThrow({ where: { companyId_email: { companyId: company.id, email: 'maya@northstarconsulting.com' } } }),
    prisma.dish.findUniqueOrThrow({ where: { sku: normalizeSku('PPB-001') }, include: { kitchenStation: true } }),
    prisma.optionGroup.findUniqueOrThrow({ where: { normalizedName: 'choose rice' } }),
    prisma.option.findUniqueOrThrow({ where: { normalizedName: 'brown rice' } }),
    prisma.companyAddress.findFirstOrThrow({ where: { companyId: company.id, isActive: true }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] }),
    prisma.pricingTier.findUniqueOrThrow({ where: { normalizedName: 'standard' } }),
  ]);
  const [dishPrice, optionPrice] = await Promise.all([
    prisma.dishTierPrice.findFirstOrThrow({ where: { dishId: dish.id, pricingTierId: tier.id } }),
    prisma.optionTierPrice.findFirstOrThrow({ where: { optionId: brownRice.id, pricingTierId: tier.id } }),
  ]);
  const statuses: OrderStatus[] = [OrderStatus.DRAFT, OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DELIVERED, OrderStatus.CANCELLED, OrderStatus.REJECTED];
  const offsets: Record<OrderStatus, number> = { DRAFT: 1, PLACED: 2, CONFIRMED: -1, DELIVERED: -2, CANCELLED: 3, REJECTED: -3 };
  const now = DateTime.now().setZone(settings.timezone).startOf('day');
  const unitPriceMinorUnits = dishPrice.explicitPriceMinorUnits + optionPrice.explicitPriceMinorUnits;
  for (const status of statuses) {
    const id = seededOrderIds[status];
    if (await prisma.order.findUnique({ where: { id }, select: { id: true } })) continue;
    const deliveryDate = relativeWorkingDate(now, offsets[status]).toJSDate();
    await prisma.order.create({
      data: {
        id, employeeId: employee.id, companyId: company.id, effectivePricingTierId: tier.id, pricingTierNameSnapshot: tier.name,
        status, deliveryDate, cutoffAt: seededCutoff(deliveryDate, settings),
        sourceCompanyAddressId: address.id, deliveryAddressLabel: address.label, deliveryAddressLine1: address.addressLine1, deliveryAddressLine2: address.addressLine2,
        deliveryCity: address.city, deliveryStateRegion: address.stateRegion, deliveryPostalCode: address.postalCode, deliveryCountry: address.country,
        deliveryTimeMinutes: company.defaultDeliveryTimeMinutes, deliveryMinutesBeforeSnapshot: company.deliveryMinutesBefore,
        packaging: company.defaultPackaging, driverInstructionsSnapshot: company.driverInstructions, totalMinorUnits: unitPriceMinorUnits,
        lines: { create: [{ dishId: dish.id, dishNameSnapshot: dish.name, dishSkuSnapshot: dish.sku, kitchenStationId: dish.kitchenStationId, kitchenStationNameSnapshot: dish.kitchenStation?.name ?? null, quantity: 1, dishUnitPriceMinorUnits: dishPrice.explicitPriceMinorUnits, lineTotalMinorUnits: unitPriceMinorUnits,
          combinations: { create: [{ selectionKey: `${riceGroup.id}:${brownRice.id}`, quantity: 1, unitPriceMinorUnits, totalMinorUnits: unitPriceMinorUnits,
            selectedOptions: { create: [{ optionGroupId: riceGroup.id, optionId: brownRice.id, optionGroupNameSnapshot: riceGroup.name, optionNameSnapshot: brownRice.name, optionUnitPriceMinorUnits: optionPrice.explicitPriceMinorUnits }] },
          }] },
        }] },
        statusEvents: { create: seededStatusEvents(id, status) },
      },
    });
  }
}

function relativeWorkingDate(start: DateTime, offset: number): DateTime {
  let value = start;
  let remaining = Math.abs(offset);
  const direction = offset < 0 ? -1 : 1;
  while (remaining > 0) {
    value = value.plus({ days: direction });
    if (value.weekday <= 5) remaining -= 1;
  }
  return value;
}

function seededCutoff(deliveryDate: Date, settings: { timezone: string; cutoffWorkingDays: number; cutoffTimeMinutes: number }): Date {
  let date = DateTime.fromJSDate(deliveryDate, { zone: settings.timezone }).startOf('day');
  let remaining = settings.cutoffWorkingDays;
  while (remaining > 0) {
    date = date.minus({ days: 1 });
    if (date.weekday <= 5) remaining -= 1;
  }
  return date.set({ hour: Math.floor(settings.cutoffTimeMinutes / 60), minute: settings.cutoffTimeMinutes % 60, second: 0, millisecond: 0 }).toUTC().toJSDate();
}

function seededEventId(orderId: string, sequence: number): string {
  return `${orderId.slice(0, -4)}e${orderId.slice(-2)}${sequence}`;
}

function seededStatusEvents(orderId: string, status: OrderStatus) {
  const events: Array<{ id: string; fromStatus: OrderStatus | null; toStatus: OrderStatus; note: string }> = [
    { id: seededEventId(orderId, 1), fromStatus: null, toStatus: OrderStatus.DRAFT, note: 'Seeded draft created.' },
  ];
  if ([OrderStatus.PLACED, OrderStatus.CONFIRMED, OrderStatus.DELIVERED, OrderStatus.REJECTED].includes(status)) {
    events.push({ id: seededEventId(orderId, 2), fromStatus: OrderStatus.DRAFT, toStatus: OrderStatus.PLACED, note: 'Seeded order placed.' });
  }
  if ([OrderStatus.CONFIRMED, OrderStatus.DELIVERED].includes(status)) {
    events.push({ id: seededEventId(orderId, 3), fromStatus: OrderStatus.PLACED, toStatus: OrderStatus.CONFIRMED, note: 'Seeded cutoff confirmation.' });
  }
  if (status === OrderStatus.DELIVERED) events.push({ id: seededEventId(orderId, 4), fromStatus: OrderStatus.CONFIRMED, toStatus: OrderStatus.DELIVERED, note: 'Seeded delivery completed.' });
  if (status === OrderStatus.CANCELLED) events.push({ id: seededEventId(orderId, 2), fromStatus: OrderStatus.DRAFT, toStatus: OrderStatus.CANCELLED, note: 'Seeded cancellation.' });
  if (status === OrderStatus.REJECTED) events.push({ id: seededEventId(orderId, 3), fromStatus: OrderStatus.PLACED, toStatus: OrderStatus.REJECTED, note: 'Seeded rejection.' });
  return events;
}

async function seedMenuCategory(name: string, sortOrder: number, isSecret: boolean) {
  const normalized = normalizeCatalogueName(name);
  return prisma.menuCategory.upsert({
    where: { normalizedName: normalized.normalizedName },
    update: {},
    create: { ...normalized, sortOrder, isSecret },
  });
}

async function seedMenuItem(categoryId: string, dishId: string, sortOrder: number) {
  return prisma.menuCategoryItem.upsert({
    where: { categoryId_dishId: { categoryId, dishId } },
    update: {},
    create: { categoryId, dishId, sortOrder },
  });
}

interface EmployeeSeed {
  companyId: string;
  name: string;
  email: string;
  phone?: string;
  canChooseDeliveryAddress?: boolean;
  canChangeDeliveryTime?: boolean;
  canChangePackaging?: boolean;
  allergenIds: string[];
  dietaryTagIds: string[];
}

async function seedEmployee(seed: EmployeeSeed) {
  const employee = await prisma.employee.upsert({
    where: { companyId_email: { companyId: seed.companyId, email: normalizeEmail(seed.email) } },
    update: {},
    create: {
      companyId: seed.companyId,
      name: seed.name,
      email: normalizeEmail(seed.email),
      phone: seed.phone ?? null,
      canChooseDeliveryAddress: seed.canChooseDeliveryAddress ?? false,
      canChangeDeliveryTime: seed.canChangeDeliveryTime ?? false,
      canChangePackaging: seed.canChangePackaging ?? false,
    },
  });

  await Promise.all([
    ...seed.allergenIds.map((allergenId) =>
      prisma.employeeAllergen.upsert({
        where: { employeeId_allergenId: { employeeId: employee.id, allergenId } },
        update: {},
        create: { employeeId: employee.id, allergenId },
      }),
    ),
    ...seed.dietaryTagIds.map((dietaryTagId) =>
      prisma.employeeDietaryTag.upsert({
        where: { employeeId_dietaryTagId: { employeeId: employee.id, dietaryTagId } },
        update: {},
        create: { employeeId: employee.id, dietaryTagId },
      }),
    ),
  ]);

  return employee;
}

async function findSeedCompany(domain: string) {
  const companyDomain = await prisma.companyEmailDomain.findUnique({
    where: { domain: normalizeCompanyDomain(domain) },
    select: { company: { select: { id: true } } },
  });
  return requiredValue(companyDomain, `Company domain ${domain}`).company;
}

interface CompanySeed {
  name: string;
  domains: string[];
  billingContactName: string;
  billingContactEmail: string;
  pricingTierId: string;
  defaultDriverId: string;
  deliveryTimeMinutes: number;
  deliveryMinutesBefore: number;
  defaultPackaging: string;
  driverInstructions: string;
  addresses: Array<{
    label: string;
    addressLine1: string;
    city: string;
    stateRegion: string;
    postalCode: string;
    country: string;
  }>;
}

async function seedCompany(seed: CompanySeed): Promise<void> {
  const primaryDomain = normalizeCompanyDomain(seed.domains[0]);
  let company = await prisma.companyEmailDomain.findUnique({
    where: { domain: primaryDomain },
    select: { company: true },
  });

  if (!company) {
    const normalizedName = normalizeCompanyName(seed.name);
    const created = await prisma.company.create({
      data: {
        ...normalizedName,
        billingContactName: seed.billingContactName,
        billingContactEmail: seed.billingContactEmail,
        workingDays: [
          Weekday.MONDAY,
          Weekday.TUESDAY,
          Weekday.WEDNESDAY,
          Weekday.THURSDAY,
          Weekday.FRIDAY,
        ],
        defaultDeliveryTimeMinutes: seed.deliveryTimeMinutes,
        deliveryMinutesBefore: seed.deliveryMinutesBefore,
        defaultPackaging: seed.defaultPackaging,
        driverInstructions: seed.driverInstructions,
        pricingTierId: seed.pricingTierId,
        defaultDriverId: seed.defaultDriverId,
        emailDomains: {
          create: seed.domains.map((domain) => ({ domain: normalizeCompanyDomain(domain) })),
        },
        addresses: { create: seed.addresses },
      },
    });
    company = { company: created };
  }

  for (const domainValue of seed.domains) {
    const domain = normalizeCompanyDomain(domainValue);
    await prisma.companyEmailDomain.upsert({
      where: { domain },
      update: {},
      create: { companyId: company.company.id, domain },
    });
  }
  for (const address of seed.addresses) {
    const existing = await prisma.companyAddress.findFirst({
      where: { companyId: company.company.id, label: address.label },
      select: { id: true },
    });
    if (!existing) {
      await prisma.companyAddress.create({ data: { companyId: company.company.id, ...address } });
    }
  }
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
    console.log(
      'Identity, settings, reference data, catalogue, pricing, Companies, Employees, Menu, and Orders seed completed.',
    );
  })
  .catch((error: unknown) => {
    console.error('Application seed failed.', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
