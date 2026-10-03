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

const prefix = 'Companies Test';

describe('companies module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let acmeId: string;
  let northstarId: string;
  let acmeAddressId: string;
  let inactiveTierId: string;
  let inactiveDriverId: string;
  let validDriverId: string;
  let premiumTierId: string;
  let kitchenSettingsBefore: unknown;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'companies-integration-test-secret';
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

    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    await removeTestData();

    const [premium, kitchenRole, driver] = await Promise.all([
      prisma.pricingTier.findUniqueOrThrow({
        where: { normalizedName: 'premium' },
        select: { id: true },
      }),
      prisma.role.findUniqueOrThrow({ where: { code: 'KITCHEN' }, select: { id: true } }),
      prisma.staffUser.findUniqueOrThrow({
        where: { email: 'driver@test.com' },
        select: { id: true },
      }),
    ]);
    premiumTierId = premium.id;
    validDriverId = driver.id;
    const inactiveTier = await prisma.pricingTier.create({
      data: {
        name: `${prefix} Inactive Tier`,
        normalizedName: `${prefix} Inactive Tier`.toLowerCase(),
        isActive: false,
      },
    });
    inactiveTierId = inactiveTier.id;
    const inactiveDriver = await prisma.staffUser.create({
      data: {
        email: 'companies-test-inactive-driver@example.test',
        passwordHash: 'not-used-by-integration-test',
        isActive: false,
        roleId: kitchenRole.id,
      },
    });
    inactiveDriverId = inactiveDriver.id;
    kitchenSettingsBefore = await prisma.kitchenSettings.findUniqueOrThrow({
      where: { key: 'GLOBAL' },
    });
  });

  after(async () => {
    await removeTestData();
    await app.close();
  });

  async function adminCookie(): Promise<string> {
    const user = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'admin@test.com' },
      select: { id: true },
    });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`;
  }

  async function kitchenCookie(): Promise<string> {
    const user = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'kitchen@test.com' },
      select: { id: true },
    });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`;
  }

  function createPayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      name: `${prefix} Acme`,
      domains: ['companies-test-acme.example'],
      billingContact: {
        name: 'Accounts Team',
        email: 'accounts@companies-test-acme.example',
        phone: '+91-9999999999',
      },
      defaultDeliveryTime: '12:30',
      defaultPackaging: 'Standard boxed meal',
      pricingTierId: premiumTierId,
      defaultDriverId: validDriverId,
      addresses: [
        {
          label: 'Main Office',
          addressLine1: '1 Test Road',
          city: 'Ahmedabad',
          stateRegion: 'Gujarat',
          postalCode: '380001',
          country: 'India',
        },
      ],
      ...overrides,
    };
  }

  it('enforces Company permissions', async () => {
    await request(app.getHttpServer()).get('/api/companies').expect(401);
    await request(app.getHttpServer())
      .get('/api/companies')
      .set('Cookie', await kitchenCookie())
      .expect(403);
  });

  it('creates a usable Company atomically with defaults, domains, address, and active derived pricing', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', await adminCookie())
      .send(createPayload({ domains: [' COMPANIES-TEST-ACME.EXAMPLE ', 'companies-test-acme.in'] }))
      .expect(201);

    acmeId = response.body.id as string;
    acmeAddressId = response.body.addresses[0].id as string;
    assert.equal(response.body.name, `${prefix} Acme`);
    assert.deepEqual(response.body.domains.map((domain: { domain: string }) => domain.domain), [
      'companies-test-acme.example',
      'companies-test-acme.in',
    ]);
    assert.deepEqual(response.body.workingDays, [
      'MONDAY',
      'TUESDAY',
      'WEDNESDAY',
      'THURSDAY',
      'FRIDAY',
    ]);
    assert.equal(response.body.defaultDeliveryTime, '12:30');
    assert.equal(response.body.pricingTier.id, premiumTierId);
    assert.equal(response.body.defaultDriver.id, validDriverId);
    assert.equal(response.body.normalizedName, undefined);
  });

  it('rejects duplicate, public, and invalid domains without partial Company creation', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ name: `${prefix} Duplicate`, domains: ['COMPANIES-TEST-ACME.EXAMPLE'] }))
      .expect(409);
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ name: `${prefix} Public`, domains: ['gmail.com'] }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ name: `${prefix} Invalid`, domains: ['https://example.com'] }))
      .expect(400);
    assert.equal(
      await prisma.company.count({ where: { name: { startsWith: `${prefix} ` } } }),
      1,
    );
  });

  it('allows duplicate Company names when their domains differ and validates tier and driver assignment', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ domains: ['companies-test-inactive-tier.example'], pricingTierId: inactiveTierId }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ domains: ['companies-test-inactive-driver.example'], defaultDriverId: inactiveDriverId }))
      .expect(400);

    const kitchen = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'kitchen@test.com' },
      select: { id: true },
    });
    await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(createPayload({ domains: ['companies-test-kitchen-driver.example'], defaultDriverId: kitchen.id }))
      .expect(400);

    const response = await request(app.getHttpServer())
      .post('/api/companies')
      .set('Cookie', admin)
      .send(
        createPayload({
          domains: ['companies-test-northstar.example'],
          addresses: [
            {
              label: 'Northstar Office',
              addressLine1: '2 Test Road',
              city: 'Vadodara',
              stateRegion: 'Gujarat',
              postalCode: '390001',
              country: 'India',
            },
            {
              label: 'Northstar Annex',
              addressLine1: '3 Test Road',
              city: 'Vadodara',
              stateRegion: 'Gujarat',
              postalCode: '390002',
              country: 'India',
            },
          ],
        }),
      )
      .expect(201);
    northstarId = response.body.id as string;
    assert.equal(response.body.name, `${prefix} Acme`);
  });

  it('manages domains atomically and preserves Company calendar separation', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .put(`/api/companies/${acmeId}/domains`)
      .set('Cookie', admin)
      .send({ domains: ['companies-test-acme.example', 'COMPANIES-TEST-REPLACED.EXAMPLE'] })
      .expect(200);
    const holiday = await request(app.getHttpServer())
      .post(`/api/companies/${acmeId}/holidays`)
      .set('Cookie', admin)
      .send({ date: '2026-12-25', name: 'Company closure' })
      .expect(201);
    assert.equal(holiday.body.date, '2026-12-25');
    await request(app.getHttpServer())
      .post(`/api/companies/${acmeId}/holidays`)
      .set('Cookie', admin)
      .send({ date: '2026-12-25' })
      .expect(409);
    await request(app.getHttpServer())
      .post(`/api/companies/${northstarId}/holidays`)
      .set('Cookie', admin)
      .send({ date: '2026-12-25' })
      .expect(201);
    assert.deepEqual(
      await prisma.kitchenSettings.findUniqueOrThrow({ where: { key: 'GLOBAL' } }),
      kitchenSettingsBefore,
    );
  });

  it('preserves address rows, protects the final active address, lists Companies, and protects active pricing assignments', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}/addresses/${acmeAddressId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(400);

    const northstar = await request(app.getHttpServer())
      .get(`/api/companies/${northstarId}`)
      .set('Cookie', admin)
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/companies/${northstarId}/addresses/${northstar.body.addresses[0].id}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(200);
    const updatedNorthstar = await request(app.getHttpServer())
      .get(`/api/companies/${northstarId}`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(updatedNorthstar.body.addresses[0].isActive, false);

    const list = await request(app.getHttpServer())
      .get(`/api/companies?search=${encodeURIComponent(prefix)}&isActive=true&page=1&pageSize=1`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(list.body.total, 2);
    assert.equal(list.body.items.length, 1);

    await request(app.getHttpServer())
      .patch(`/api/pricing/tiers/${premiumTierId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(400);
  });

  async function removeTestData(): Promise<void> {
    const companies = await prisma.company.findMany({
      where: { name: { startsWith: `${prefix} ` } },
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);
    await prisma.companyAddress.deleteMany({ where: { companyId: { in: companyIds } } });
    await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    await prisma.pricingTier.deleteMany({
      where: { normalizedName: `${prefix} Inactive Tier`.toLowerCase() },
    });
    await prisma.staffUser.deleteMany({
      where: { email: 'companies-test-inactive-driver@example.test' },
    });
  }
});
