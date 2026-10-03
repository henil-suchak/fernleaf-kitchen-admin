import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DishTemperature } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { SESSION_COOKIE_NAME } from '../src/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { createValidationException } from '../src/common/errors/validation-exception.factory';
import { derivePriceMinorUnits } from '../src/common/money/money.util';
import { PricingResolver } from '../src/pricing/pricing-resolver.service';
import { PrismaService } from '../src/prisma/prisma.service';

const tierPrefix = 'pricing test';

describe('pricing module', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let pricingResolver: PricingResolver;
  let originalDefaultTierId: string;
  let dishId: string;
  let missingDishId: string;
  let optionId: string;
  let missingOptionId: string;
  let directTierId: string;
  let baseTierId: string;
  let itemCostTierId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'pricing-integration-test-secret';
    process.env.JWT_EXPIRES_IN = '8h';
    process.env.FRONTEND_URL = 'http://localhost:3000';

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
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
    pricingResolver = moduleRef.get(PricingResolver);
    originalDefaultTierId = (
      await prisma.pricingTier.findFirstOrThrow({
        where: { isDefault: true },
        select: { id: true },
      })
    ).id;

    await removeTestData();
    const [dish, missingDish, option, missingOption] = await Promise.all([
      prisma.dish.create({
        data: {
          name: 'Pricing Test Dish',
          sku: 'PRICING-TEST-DISH',
          temperature: DishTemperature.HOT,
          costMinorUnits: 211,
          minimumQuantity: 1,
        },
      }),
      prisma.dish.create({
        data: {
          name: 'Pricing Test Missing Dish',
          sku: 'PRICING-TEST-MISSING-DISH',
          temperature: DishTemperature.HOT,
          costMinorUnits: 214,
          minimumQuantity: 1,
        },
      }),
      prisma.option.create({
        data: {
          name: 'Pricing Test Option',
          normalizedName: 'pricing test option',
          costMinorUnits: 216,
        },
      }),
      prisma.option.create({
        data: {
          name: 'Pricing Test Missing Option',
          normalizedName: 'pricing test missing option',
          costMinorUnits: 210,
        },
      }),
    ]);
    dishId = dish.id;
    missingDishId = missingDish.id;
    optionId = option.id;
    missingOptionId = missingOption.id;
  });

  after(async () => {
    await prisma.pricingTier.updateMany({ data: { isDefault: false } });
    await prisma.pricingTier.update({
      where: { id: originalDefaultTierId },
      data: { isDefault: true },
    });
    await removeTestData();
    await app.close();
  });

  async function adminCookie(): Promise<string> {
    const staffUser = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'admin@test.com' },
      select: { id: true },
    });
    const token = await jwtService.signAsync({ sub: staffUser.id });
    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  it('enforces pricing permissions', async () => {
    await request(app.getHttpServer()).get('/api/pricing/tiers').expect(401);

    const kitchenUser = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'kitchen@test.com' },
      select: { id: true },
    });
    const kitchenToken = await jwtService.signAsync({ sub: kitchenUser.id });
    await request(app.getHttpServer())
      .get('/api/pricing/tiers')
      .set('Cookie', `${SESSION_COOKIE_NAME}=${kitchenToken}`)
      .expect(403);
  });

  it('creates a direct tier and resolves direct Dish and Option prices', async () => {
    const admin = await adminCookie();
    const tier = await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({ name: '  Pricing   Test Direct ' })
      .expect(201);
    directTierId = tier.body.id as string;
    assert.equal(tier.body.name, 'Pricing Test Direct');
    assert.equal('pricingMode' in tier.body, false);

    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${directTierId}/dish-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ dishId, explicitPriceMinorUnits: 210 }] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${directTierId}/option-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ optionId, explicitPriceMinorUnits: 215 }] })
      .expect(200);

    assert.deepEqual(await pricingResolver.resolveDishPrice(dishId, directTierId), {
      available: true,
      priceMinorUnits: 210,
      source: 'DIRECT',
    });
    assert.deepEqual(await pricingResolver.resolveOptionPrice(optionId, directTierId), {
      available: true,
      priceMinorUnits: 215,
      source: 'DIRECT',
    });
  });

  it('resolves BASE_TIER prices and manual overrides for Dishes and Options', async () => {
    const admin = await adminCookie();
    const tier = await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({
        name: 'Pricing Test Base Derived',
        derivationSource: 'BASE_TIER',
        baseTierId: directTierId,
        multiplierBps: 11_500,
      })
      .expect(201);
    baseTierId = tier.body.id as string;

    assert.deepEqual(await pricingResolver.resolveDishPrice(dishId, baseTierId), {
      available: true,
      priceMinorUnits: 245,
      source: 'DERIVED_BASE_TIER',
    });
    assert.deepEqual(await pricingResolver.resolveOptionPrice(optionId, baseTierId), {
      available: true,
      priceMinorUnits: 250,
      source: 'DERIVED_BASE_TIER',
    });

    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${baseTierId}/dish-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ dishId, explicitPriceMinorUnits: 225 }] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${baseTierId}/option-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ optionId, explicitPriceMinorUnits: 230 }] })
      .expect(200);

    assertResolvedSource(
      await pricingResolver.resolveDishPrice(dishId, baseTierId),
      'MANUAL_OVERRIDE',
    );
    assertResolvedSource(
      await pricingResolver.resolveOptionPrice(optionId, baseTierId),
      'MANUAL_OVERRIDE',
    );

    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${baseTierId}/dish-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ dishId, explicitPriceMinorUnits: null }] })
      .expect(200);
    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${baseTierId}/option-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ optionId, explicitPriceMinorUnits: null }] })
      .expect(200);
    assertResolvedSource(
      await pricingResolver.resolveDishPrice(dishId, baseTierId),
      'DERIVED_BASE_TIER',
    );
  });

  it('resolves ITEM_COST prices for Dishes and Options using exact upward rounding', async () => {
    const tier = await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', await adminCookie())
      .send({
        name: 'Pricing Test Item Cost',
        derivationSource: 'ITEM_COST',
        multiplierBps: 10_000,
      })
      .expect(201);
    itemCostTierId = tier.body.id as string;

    assert.deepEqual(await pricingResolver.resolveDishPrice(dishId, itemCostTierId), {
      available: true,
      priceMinorUnits: 215,
      source: 'DERIVED_ITEM_COST',
    });
    assert.deepEqual(await pricingResolver.resolveOptionPrice(optionId, itemCostTierId), {
      available: true,
      priceMinorUnits: 220,
      source: 'DERIVED_ITEM_COST',
    });
    assert.deepEqual(
      [210, 211, 214, 215, 216].map((value) =>
        derivePriceMinorUnits(value, 10_000),
      ),
      [210, 215, 215, 215, 220],
    );
  });

  it('reports missing direct prices and rejects atomic bulk updates with invalid items', async () => {
    assert.deepEqual(await pricingResolver.resolveDishPrice(missingDishId, directTierId), {
      available: false,
      reason: 'MISSING_PRICE',
    });

    const optionResponse = await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${directTierId}/option-prices`)
      .set('Cookie', await adminCookie())
      .send({
        entries: [
          { optionId: missingOptionId, explicitPriceMinorUnits: 500 },
          {
            optionId: '00000000-0000-4000-8000-000000000000',
            explicitPriceMinorUnits: 700,
          },
        ],
      })
      .expect(404);
    assert.equal(optionResponse.body.code, 'NOT_FOUND');
    assert.deepEqual(
      await pricingResolver.resolveOptionPrice(missingOptionId, directTierId),
      { available: false, reason: 'MISSING_PRICE' },
    );
    assert.deepEqual(
      await pricingResolver.resolveOptionPrice(missingOptionId, directTierId),
      { available: false, reason: 'MISSING_PRICE' },
    );

    const response = await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${directTierId}/dish-prices`)
      .set('Cookie', await adminCookie())
      .send({
        entries: [
          { dishId: missingDishId, explicitPriceMinorUnits: 500 },
          {
            dishId: '00000000-0000-4000-8000-000000000000',
            explicitPriceMinorUnits: 700,
          },
        ],
      })
      .expect(404);
    assert.equal(response.body.code, 'NOT_FOUND');
    assert.deepEqual(await pricingResolver.resolveDishPrice(missingDishId, directTierId), {
      available: false,
      reason: 'MISSING_PRICE',
    });
  });

  it('enforces tier configuration, uniqueness, default transfer, and base dependency rules', async () => {
    const admin = await adminCookie();
    const duplicate = await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({ name: 'pricing test direct' })
      .expect(409);
    assert.equal(duplicate.body.code, 'CONFLICT');

    await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({
        name: 'Pricing Test Derived From Derived',
        derivationSource: 'BASE_TIER',
        baseTierId,
        multiplierBps: 10_000,
      })
      .expect(400);

    const inactive = await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({ name: 'Pricing Test Inactive Base', isActive: false })
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/pricing/tiers')
      .set('Cookie', admin)
      .send({
        name: 'Pricing Test Inactive Derived',
        derivationSource: 'BASE_TIER',
        baseTierId: inactive.body.id,
        multiplierBps: 10_000,
      })
      .expect(400);

    const transferred = await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${directTierId}`)
      .set('Cookie', admin)
      .send({ isDefault: true })
      .expect(200);
    assert.equal(transferred.body.isDefault, true);
    assert.equal(await prisma.pricingTier.count({ where: { isDefault: true } }), 1);

    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${directTierId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${directTierId}`)
      .set('Cookie', admin)
      .send({ isDefault: false })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${baseTierId}`)
      .set('Cookie', admin)
      .send({ baseTierId: baseTierId })
      .expect(400);

    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${originalDefaultTierId}`)
      .set('Cookie', admin)
      .send({ isDefault: true })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${directTierId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(400);
  });

  it('returns direct, derived, item-cost, override, and unavailable matrix states', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .put(`/api/pricing/tiers/${baseTierId}/dish-prices`)
      .set('Cookie', admin)
      .send({ entries: [{ dishId, explicitPriceMinorUnits: 225 }] })
      .expect(200);

    const directMatrix = await request(app.getHttpServer())
      .get(`/api/pricing/tiers/${directTierId}/matrix`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(
      directMatrix.body.dishes.find((item: { id: string }) => item.id === dishId).source,
      'DIRECT',
    );
    assert.equal(
      directMatrix.body.dishes.find((item: { id: string }) => item.id === missingDishId).available,
      false,
    );

    const baseMatrix = await request(app.getHttpServer())
      .get(`/api/pricing/tiers/${baseTierId}/matrix`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(
      baseMatrix.body.dishes.find((item: { id: string }) => item.id === dishId).source,
      'MANUAL_OVERRIDE',
    );

    const itemCostMatrix = await request(app.getHttpServer())
      .get(`/api/pricing/tiers/${itemCostTierId}/matrix`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(
      itemCostMatrix.body.options.find((item: { id: string }) => item.id === optionId).source,
      'DERIVED_ITEM_COST',
    );
  });

  async function removeTestData(): Promise<void> {
    const tiers = await prisma.pricingTier.findMany({
      where: { normalizedName: { startsWith: tierPrefix } },
      select: { id: true },
    });
    const tierIds = tiers.map((tier) => tier.id);
    await prisma.dishTierPrice.deleteMany({ where: { pricingTierId: { in: tierIds } } });
    await prisma.optionTierPrice.deleteMany({ where: { pricingTierId: { in: tierIds } } });
    await prisma.pricingTier.updateMany({
      where: { baseTierId: { in: tierIds } },
      data: { baseTierId: null },
    });
    await prisma.pricingTier.deleteMany({ where: { id: { in: tierIds } } });
    await prisma.dish.deleteMany({ where: { sku: { startsWith: 'PRICING-TEST-' } } });
    await prisma.option.deleteMany({
      where: { normalizedName: { startsWith: tierPrefix } },
    });
  }
});

function assertResolvedSource(
  resolution: Awaited<ReturnType<PricingResolver['resolveDishPrice']>>,
  expectedSource: 'DIRECT' | 'MANUAL_OVERRIDE' | 'DERIVED_BASE_TIER' | 'DERIVED_ITEM_COST',
): void {
  assert.equal(resolution.available, true);
  if (resolution.available) {
    assert.equal(resolution.source, expectedSource);
  }
}
