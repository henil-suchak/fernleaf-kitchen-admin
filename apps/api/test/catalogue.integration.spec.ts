import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { SESSION_COOKIE_NAME } from '../src/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { createValidationException } from '../src/common/errors/validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';

const testPrefix = 'catalogue test';

describe('catalogue module', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let activeStationId: string;
  let inactiveStationId: string;
  let activeAllergenId: string;
  let inactiveAllergenId: string;
  let activeDietaryTagId: string;
  let inactiveDietaryTagId: string;
  let dishId: string;
  let optionOneId: string;
  let optionTwoId: string;
  let optionGroupId: string;
  let inactiveOptionId: string;
  let inactiveOptionGroupId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'catalogue-integration-test-secret';
    process.env.JWT_EXPIRES_IN = '8h';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: createValidationException,
      }),
    );
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();

    jwtService = moduleRef.get(JwtService);
    prisma = moduleRef.get(PrismaService);
    await removeTestData();

    const [activeStation, inactiveStation, activeAllergen, inactiveAllergen] =
      await Promise.all([
        prisma.kitchenStation.create({
          data: referenceValue('Catalogue Test Active Station'),
        }),
        prisma.kitchenStation.create({
          data: { ...referenceValue('Catalogue Test Inactive Station'), isActive: false },
        }),
        prisma.allergen.create({
          data: referenceValue('Catalogue Test Active Allergen'),
        }),
        prisma.allergen.create({
          data: { ...referenceValue('Catalogue Test Inactive Allergen'), isActive: false },
        }),
      ]);
    const [activeDietaryTag, inactiveDietaryTag] = await Promise.all([
      prisma.dietaryTag.create({
        data: referenceValue('Catalogue Test Active Dietary Tag'),
      }),
      prisma.dietaryTag.create({
        data: {
          ...referenceValue('Catalogue Test Inactive Dietary Tag'),
          isActive: false,
        },
      }),
    ]);

    activeStationId = activeStation.id;
    inactiveStationId = inactiveStation.id;
    activeAllergenId = activeAllergen.id;
    inactiveAllergenId = inactiveAllergen.id;
    activeDietaryTagId = activeDietaryTag.id;
    inactiveDietaryTagId = inactiveDietaryTag.id;
  });

  after(async () => {
    await removeTestData();
    await app.close();
  });

  async function adminCookie(): Promise<string> {
    return cookieFor('admin@test.com');
  }

  async function cookieFor(email: string): Promise<string> {
    const staffUser = await prisma.staffUser.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const token = await jwtService.signAsync({ sub: staffUser.id });

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  it('enforces authentication and catalogue permissions', async () => {
    await request(app.getHttpServer()).get('/api/catalogue/dishes').expect(401);

    await request(app.getHttpServer())
      .get('/api/catalogue/dishes')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(403);
  });

  it('creates a dish with valid active reference data', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/catalogue/dishes')
      .set('Cookie', await adminCookie())
      .send({
        name: '  Catalogue   Test Bowl ',
        description: 'A catalogue integration-test dish.',
        sku: 'cattest-dish-001',
        temperature: 'HOT',
        costMinorUnits: 1250,
        minimumQuantity: 1,
        kitchenStationId: activeStationId,
        allergenIds: [activeAllergenId],
        dietaryTagIds: [activeDietaryTagId],
      })
      .expect(201);

    dishId = response.body.id as string;
    assert.equal(response.body.name, 'Catalogue Test Bowl');
    assert.equal(response.body.sku, 'CATTEST-DISH-001');
    assert.equal(response.body.kitchenStation.id, activeStationId);
    assert.deepEqual(
      response.body.allergens.map((allergen: { id: string }) => allergen.id),
      [activeAllergenId],
    );
  });

  it('rejects inactive reference data during dish creation', async () => {
    const admin = await adminCookie();
    const inactiveStation = await request(app.getHttpServer())
      .post('/api/catalogue/dishes')
      .set('Cookie', admin)
      .send({
        name: 'Inactive Station Dish',
        sku: 'cattest-inactive-station',
        temperature: 'HOT',
        costMinorUnits: 1,
        minimumQuantity: 1,
        kitchenStationId: inactiveStationId,
      })
      .expect(400);
    assert.equal(inactiveStation.body.code, 'BUSINESS_RULE_VIOLATION');

    const inactiveAllergen = await request(app.getHttpServer())
      .post('/api/catalogue/dishes')
      .set('Cookie', admin)
      .send({
        name: 'Inactive Allergen Dish',
        sku: 'cattest-inactive-allergen',
        temperature: 'HOT',
        costMinorUnits: 1,
        minimumQuantity: 1,
        allergenIds: [inactiveAllergenId],
      })
      .expect(400);
    assert.equal(inactiveAllergen.body.code, 'BUSINESS_RULE_VIOLATION');

    const inactiveDietaryTag = await request(app.getHttpServer())
      .post('/api/catalogue/dishes')
      .set('Cookie', admin)
      .send({
        name: 'Inactive Dietary Tag Dish',
        sku: 'cattest-inactive-dietary-tag',
        temperature: 'HOT',
        costMinorUnits: 1,
        minimumQuantity: 1,
        dietaryTagIds: [inactiveDietaryTagId],
      })
      .expect(400);
    assert.equal(inactiveDietaryTag.body.code, 'BUSINESS_RULE_VIOLATION');
  });

  it('maps a case-insensitive duplicate SKU to conflict', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/catalogue/dishes')
      .set('Cookie', await adminCookie())
      .send({
        name: 'Duplicate SKU Dish',
        sku: 'CATTEST-dish-001',
        temperature: 'COLD',
        costMinorUnits: 1,
        minimumQuantity: 1,
      })
      .expect(409);

    assert.equal(response.body.code, 'CONFLICT');
  });

  it('creates reusable options and rejects a normalized duplicate', async () => {
    const admin = await adminCookie();
    const first = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({
        name: '  Catalogue   Test Rice ',
        costMinorUnits: 500,
        allergenIds: [activeAllergenId],
        dietaryTagIds: [activeDietaryTagId],
      })
      .expect(201);
    optionOneId = first.body.id as string;
    assert.equal(first.body.name, 'Catalogue Test Rice');
    assert.equal(first.body.costMinorUnits, 500);
    assert.equal(first.body.allergens[0].id, activeAllergenId);
    assert.equal(first.body.dietaryTags[0].id, activeDietaryTagId);

    const duplicate = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({ name: 'catalogue test rice', costMinorUnits: 500 })
      .expect(409);
    assert.equal(duplicate.body.code, 'CONFLICT');

    const second = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({ name: 'Catalogue Test Sauce', costMinorUnits: 300 })
      .expect(201);
    optionTwoId = second.body.id as string;

    const inactive = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({ name: 'Catalogue Test Inactive Option', costMinorUnits: 100 })
      .expect(201);
    inactiveOptionId = inactive.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/catalogue/options/${inactiveOptionId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(200);
  });

  it('rejects invalid option cost and inactive option reference assignments', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({ name: 'Catalogue Test Negative Cost', costMinorUnits: -1 })
      .expect(400);

    const inactiveAllergen = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({
        name: 'Catalogue Test Inactive Allergen Option',
        costMinorUnits: 100,
        allergenIds: [inactiveAllergenId],
      })
      .expect(400);
    assert.equal(inactiveAllergen.body.code, 'BUSINESS_RULE_VIOLATION');

    const inactiveDietaryTag = await request(app.getHttpServer())
      .post('/api/catalogue/options')
      .set('Cookie', admin)
      .send({
        name: 'Catalogue Test Inactive Dietary Tag Option',
        costMinorUnits: 100,
        dietaryTagIds: [inactiveDietaryTagId],
      })
      .expect(400);
    assert.equal(inactiveDietaryTag.body.code, 'BUSINESS_RULE_VIOLATION');
  });

  it('creates reusable option groups and rejects a normalized duplicate', async () => {
    const admin = await adminCookie();
    const first = await request(app.getHttpServer())
      .post('/api/catalogue/option-groups')
      .set('Cookie', admin)
      .send({ name: 'Catalogue Test Choice' })
      .expect(201);
    optionGroupId = first.body.id as string;

    const duplicate = await request(app.getHttpServer())
      .post('/api/catalogue/option-groups')
      .set('Cookie', admin)
      .send({ name: ' catalogue  test choice ' })
      .expect(409);
    assert.equal(duplicate.body.code, 'CONFLICT');

    const inactive = await request(app.getHttpServer())
      .post('/api/catalogue/option-groups')
      .set('Cookie', admin)
      .send({ name: 'Catalogue Test Inactive Group' })
      .expect(201);
    inactiveOptionGroupId = inactive.body.id as string;
    await request(app.getHttpServer())
      .patch(`/api/catalogue/option-groups/${inactiveOptionGroupId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(200);
  });

  it('replaces ordered option-group membership atomically', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/catalogue/option-groups/${optionGroupId}/options`)
      .set('Cookie', await adminCookie())
      .send({
        options: [
          { optionId: optionTwoId, sortOrder: 1 },
          { optionId: optionOneId, sortOrder: 2 },
        ],
      })
      .expect(200);

    assert.deepEqual(
      response.body.options.map((option: { id: string }) => option.id),
      [optionTwoId, optionOneId],
    );
  });

  it('rejects duplicate options, duplicate sort orders, and inactive options', async () => {
    const admin = await adminCookie();
    const duplicateOption = await request(app.getHttpServer())
      .put(`/api/catalogue/option-groups/${optionGroupId}/options`)
      .set('Cookie', admin)
      .send({
        options: [
          { optionId: optionOneId, sortOrder: 1 },
          { optionId: optionOneId, sortOrder: 2 },
        ],
      })
      .expect(400);
    assert.equal(duplicateOption.body.code, 'VALIDATION_ERROR');

    const duplicateSortOrder = await request(app.getHttpServer())
      .put(`/api/catalogue/option-groups/${optionGroupId}/options`)
      .set('Cookie', admin)
      .send({
        options: [
          { optionId: optionOneId, sortOrder: 1 },
          { optionId: optionTwoId, sortOrder: 1 },
        ],
      })
      .expect(400);
    assert.equal(duplicateSortOrder.body.code, 'VALIDATION_ERROR');

    const inactiveOption = await request(app.getHttpServer())
      .put(`/api/catalogue/option-groups/${optionGroupId}/options`)
      .set('Cookie', admin)
      .send({ options: [{ optionId: inactiveOptionId, sortOrder: 1 }] })
      .expect(400);
    assert.equal(inactiveOption.body.code, 'BUSINESS_RULE_VIOLATION');
  });

  it('replaces dish group configuration and persists required state', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/catalogue/dishes/${dishId}/option-groups`)
      .set('Cookie', await adminCookie())
      .send({
        groups: [{ optionGroupId, isRequired: true, sortOrder: 1 }],
      })
      .expect(200);

    assert.equal(response.body.optionGroups[0].id, optionGroupId);
    assert.equal(response.body.optionGroups[0].isRequired, true);
    assert.deepEqual(
      response.body.optionGroups[0].options.map((option: { id: string }) => option.id),
      [optionTwoId, optionOneId],
    );
  });

  it('rejects inactive option groups for new dish configuration', async () => {
    const response = await request(app.getHttpServer())
      .put(`/api/catalogue/dishes/${dishId}/option-groups`)
      .set('Cookie', await adminCookie())
      .send({
        groups: [
          { optionGroupId: inactiveOptionGroupId, isRequired: false, sortOrder: 1 },
        ],
      })
      .expect(400);

    assert.equal(response.body.code, 'BUSINESS_RULE_VIOLATION');
  });

  it('keeps existing relationships readable after referenced values are deactivated', async () => {
    await Promise.all([
      prisma.kitchenStation.update({
        where: { id: activeStationId },
        data: { isActive: false },
      }),
      prisma.allergen.update({
        where: { id: activeAllergenId },
        data: { isActive: false },
      }),
      prisma.dietaryTag.update({
        where: { id: activeDietaryTagId },
        data: { isActive: false },
      }),
      prisma.option.update({
        where: { id: optionOneId },
        data: { isActive: false },
      }),
      prisma.optionGroup.update({
        where: { id: optionGroupId },
        data: { isActive: false },
      }),
    ]);

    const response = await request(app.getHttpServer())
      .get(`/api/catalogue/dishes/${dishId}`)
      .set('Cookie', await adminCookie())
      .expect(200);

    assert.equal(response.body.kitchenStation.isActive, false);
    assert.equal(response.body.allergens[0].isActive, false);
    assert.equal(response.body.dietaryTags[0].isActive, false);
    assert.equal(response.body.optionGroups[0].isActive, false);
    assert.equal(response.body.optionGroups[0].options[1].isActive, false);
    assert.equal(response.body.optionGroups[0].options[1].allergens[0].isActive, false);
    assert.equal(response.body.optionGroups[0].options[1].dietaryTags[0].isActive, false);
  });

  async function removeTestData(): Promise<void> {
    const [optionGroups, options] = await Promise.all([
      prisma.optionGroup.findMany({
        where: { normalizedName: { startsWith: testPrefix } },
        select: { id: true },
      }),
      prisma.option.findMany({
        where: { normalizedName: { startsWith: testPrefix } },
        select: { id: true },
      }),
    ]);
    const optionGroupIds = optionGroups.map((optionGroup) => optionGroup.id);
    const optionIds = options.map((option) => option.id);

    await prisma.dish.deleteMany({ where: { sku: { startsWith: 'CATTEST-' } } });
    await prisma.dishOptionGroup.deleteMany({
      where: { optionGroupId: { in: optionGroupIds } },
    });
    await prisma.optionGroupOption.deleteMany({
      where: {
        OR: [
          { optionGroupId: { in: optionGroupIds } },
          { optionId: { in: optionIds } },
        ],
      },
    });
    await prisma.optionGroup.deleteMany({ where: { id: { in: optionGroupIds } } });
    await prisma.option.deleteMany({ where: { id: { in: optionIds } } });
    await Promise.all([
      prisma.allergen.deleteMany({
        where: { normalizedName: { startsWith: testPrefix } },
      }),
      prisma.dietaryTag.deleteMany({
        where: { normalizedName: { startsWith: testPrefix } },
      }),
      prisma.kitchenStation.deleteMany({
        where: { normalizedName: { startsWith: testPrefix } },
      }),
    ]);
  }
});

function referenceValue(name: string): { name: string; normalizedName: string } {
  return { name, normalizedName: name.toLowerCase() };
}
