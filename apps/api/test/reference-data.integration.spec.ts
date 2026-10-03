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

const testNormalizedNames = [
  'test milk',
  'test peanuts',
  'test eggs',
  'test dietary tag',
  'test kitchen station',
  'test prep station',
];

describe('reference data module', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let testAllergenId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'reference-data-integration-test-secret';
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

    await Promise.all([
      prisma.allergen.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
      prisma.dietaryTag.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
      prisma.kitchenStation.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
    ]);
  });

  after(async () => {
    await Promise.all([
      prisma.allergen.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
      prisma.dietaryTag.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
      prisma.kitchenStation.deleteMany({
        where: { normalizedName: { in: testNormalizedNames } },
      }),
    ]);
    await app.close();
  });

  async function cookieFor(email: string): Promise<string> {
    const staffUser = await prisma.staffUser.findUniqueOrThrow({
      where: { email },
      select: { id: true },
    });
    const token = await jwtService.signAsync({ sub: staffUser.id });

    return `${SESSION_COOKIE_NAME}=${token}`;
  }

  it('creates an allergen and normalizes its name', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/reference-data/allergens')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ name: '  Test   Milk  ' })
      .expect(201);

    testAllergenId = response.body.id as string;
    assert.equal(response.body.name, 'Test Milk');
    assert.equal(response.body.isActive, true);

    const created = await prisma.allergen.findUniqueOrThrow({
      where: { id: testAllergenId },
    });
    assert.equal(created.normalizedName, 'test milk');
  });

  it('rejects a case-insensitive duplicate create', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/reference-data/allergens')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ name: 'TEST MILK' })
      .expect(409);

    assert.equal(response.body.code, 'CONFLICT');
  });

  it('rejects a rename conflict', async () => {
    const adminCookie = await cookieFor('admin@test.com');
    const first = await request(app.getHttpServer())
      .post('/api/reference-data/allergens')
      .set('Cookie', adminCookie)
      .send({ name: 'Test Peanuts' })
      .expect(201);
    const second = await request(app.getHttpServer())
      .post('/api/reference-data/allergens')
      .set('Cookie', adminCookie)
      .send({ name: 'Test Eggs' })
      .expect(201);

    const response = await request(app.getHttpServer())
      .patch(`/api/reference-data/allergens/${second.body.id as string}`)
      .set('Cookie', adminCookie)
      .send({ name: ' TEST PEANUTS ' })
      .expect(409);

    assert.equal(response.body.code, 'CONFLICT');
    assert.equal(first.body.name, 'Test Peanuts');
  });

  it('deactivates and reactivates an allergen', async () => {
    const adminCookie = await cookieFor('admin@test.com');
    const deactivated = await request(app.getHttpServer())
      .patch(`/api/reference-data/allergens/${testAllergenId}`)
      .set('Cookie', adminCookie)
      .send({ isActive: false })
      .expect(200);

    assert.equal(deactivated.body.isActive, false);

    const reactivated = await request(app.getHttpServer())
      .patch(`/api/reference-data/allergens/${testAllergenId}`)
      .set('Cookie', adminCookie)
      .send({ isActive: true })
      .expect(200);

    assert.equal(reactivated.body.isActive, true);
  });

  it('rejects an empty update and maps a missing record to not found', async () => {
    const adminCookie = await cookieFor('admin@test.com');

    await request(app.getHttpServer())
      .patch(`/api/reference-data/allergens/${testAllergenId}`)
      .set('Cookie', adminCookie)
      .send({})
      .expect(400);

    const response = await request(app.getHttpServer())
      .patch('/api/reference-data/allergens/00000000-0000-4000-8000-000000000000')
      .set('Cookie', adminCookie)
      .send({ isActive: false })
      .expect(404);

    assert.equal(response.body.code, 'NOT_FOUND');
  });

  it('smoke-tests dietary tag and kitchen station routes', async () => {
    const adminCookie = await cookieFor('admin@test.com');
    const dietaryTag = await request(app.getHttpServer())
      .post('/api/reference-data/dietary-tags')
      .set('Cookie', adminCookie)
      .send({ name: 'Test Dietary Tag' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/reference-data/dietary-tags/${dietaryTag.body.id as string}`)
      .set('Cookie', adminCookie)
      .send({ isActive: false })
      .expect(200);

    const dietaryTags = await request(app.getHttpServer())
      .get('/api/reference-data/dietary-tags')
      .set('Cookie', adminCookie)
      .expect(200);
    assert.ok(
      dietaryTags.body.some(
        (value: { id: string }) => value.id === dietaryTag.body.id,
      ),
    );

    const kitchenStation = await request(app.getHttpServer())
      .post('/api/reference-data/kitchen-stations')
      .set('Cookie', adminCookie)
      .send({ name: 'Test Kitchen Station' })
      .expect(201);

    await request(app.getHttpServer())
      .patch(`/api/reference-data/kitchen-stations/${kitchenStation.body.id as string}`)
      .set('Cookie', adminCookie)
      .send({ name: 'Test Prep Station' })
      .expect(200);

    const kitchenStations = await request(app.getHttpServer())
      .get('/api/reference-data/kitchen-stations')
      .set('Cookie', adminCookie)
      .expect(200);
    assert.ok(
      kitchenStations.body.some(
        (value: { id: string }) => value.id === kitchenStation.body.id,
      ),
    );
  });

  it('enforces catalogue permissions', async () => {
    await request(app.getHttpServer())
      .get('/api/reference-data/allergens')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(403);
  });
});
