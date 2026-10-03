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

const prefix = 'Employees Test';

describe('employees module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let acmeId: string;
  let northstarId: string;
  let inactiveCompanyId: string;
  let milkId: string;
  let vegetarianId: string;
  let inactiveAllergenId: string;
  let inactiveDietaryTagId: string;
  let createdEmployeeId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'employees-integration-test-secret';
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

    const [milk, vegetarian] = await Promise.all([
      prisma.allergen.findUniqueOrThrow({
        where: { normalizedName: 'milk' },
        select: { id: true },
      }),
      prisma.dietaryTag.findUniqueOrThrow({
        where: { normalizedName: 'vegetarian' },
        select: { id: true },
      }),
    ]);
    milkId = milk.id;
    vegetarianId = vegetarian.id;

    acmeId = await createTestCompany('active-acme', true);
    northstarId = await createTestCompany('active-northstar', true);
    inactiveCompanyId = await createTestCompany('inactive', false);
    const [inactiveAllergen, inactiveDietaryTag] = await Promise.all([
      prisma.allergen.create({
        data: {
          name: `${prefix} Inactive Allergen`,
          normalizedName: `${prefix} Inactive Allergen`.toLowerCase(),
          isActive: false,
        },
      }),
      prisma.dietaryTag.create({
        data: {
          name: `${prefix} Inactive Dietary Tag`,
          normalizedName: `${prefix} Inactive Dietary Tag`.toLowerCase(),
          isActive: false,
        },
      }),
    ]);
    inactiveAllergenId = inactiveAllergen.id;
    inactiveDietaryTagId = inactiveDietaryTag.id;
  });

  after(async () => {
    await removeTestData();
    await app.close();
  });

  async function adminCookie(): Promise<string> {
    const admin = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'admin@test.com' },
      select: { id: true },
    });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: admin.id })}`;
  }

  async function kitchenCookie(): Promise<string> {
    const kitchen = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'kitchen@test.com' },
      select: { id: true },
    });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: kitchen.id })}`;
  }

  function employeePayload(overrides: Record<string, unknown> = {}): Record<string, unknown> {
    return {
      companyId: acmeId,
      name: '  Priya   Shah  ',
      email: 'PRIYA@EXAMPLE.TEST',
      phone: '+91 90000 00000',
      canChooseDeliveryAddress: true,
      canChangeDeliveryTime: false,
      canChangePackaging: true,
      allergenIds: [milkId],
      dietaryTagIds: [vegetarianId],
      ...overrides,
    };
  }

  it('enforces Employee permissions', async () => {
    await request(app.getHttpServer()).get('/api/employees').expect(401);
    await request(app.getHttpServer())
      .get('/api/employees')
      .set('Cookie', await kitchenCookie())
      .expect(403);
  });

  it('creates an Employee with canonical email, flags, and active reference memberships', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', await adminCookie())
      .send(employeePayload())
      .expect(201);

    createdEmployeeId = response.body.id as string;
    assert.equal(response.body.name, 'Priya Shah');
    assert.equal(response.body.email, 'priya@example.test');
    assert.equal(response.body.company.id, acmeId);
    assert.equal(response.body.canChooseDeliveryAddress, true);
    assert.equal(response.body.canChangeDeliveryTime, false);
    assert.equal(response.body.canChangePackaging, true);
    assert.deepEqual(response.body.allergens.map((allergen: { id: string }) => allergen.id), [milkId]);
    assert.deepEqual(
      response.body.dietaryTags.map((dietaryTag: { id: string }) => dietaryTag.id),
      [vegetarianId],
    );
    assert.equal(response.body.isCompanyOwner, false);
  });

  it('rejects a missing or inactive Company and inactive preference references', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ companyId: inactiveCompanyId, email: 'inactive-company@example.test' }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ companyId: '61d3d5a3-7205-4893-b016-3aa7fd312df1', email: 'missing-company@example.test' }))
      .expect(404);
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'inactive-allergen@example.test', allergenIds: [inactiveAllergenId] }))
      .expect(400);
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'inactive-tag@example.test', dietaryTagIds: [inactiveDietaryTagId] }))
      .expect(400);
  });

  it('uses email uniqueness per Company and catches a destination Company conflict', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'duplicate@example.test' }))
      .expect(201);
    await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'DUPLICATE@example.test' }))
      .expect(409);
    const inOtherCompany = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ companyId: northstarId, email: 'duplicate@example.test' }))
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/employees/${inOtherCompany.body.id as string}`)
      .set('Cookie', admin)
      .send({ companyId: acmeId })
      .expect(409);
  });

  it('replaces supplied preference lists and updates Employee scalar fields', async () => {
    const response = await request(app.getHttpServer())
      .patch(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', await adminCookie())
      .send({
        name: ' Priya Updated ',
        email: 'PRIYA.UPDATED@EXAMPLE.TEST',
        phone: null,
        canChangeDeliveryTime: true,
        allergenIds: [],
        dietaryTagIds: [],
      })
      .expect(200);
    assert.equal(response.body.name, 'Priya Updated');
    assert.equal(response.body.email, 'priya.updated@example.test');
    assert.equal(response.body.phone, null);
    assert.equal(response.body.canChangeDeliveryTime, true);
    assert.deepEqual(response.body.allergens, []);
    assert.deepEqual(response.body.dietaryTags, []);
  });

  it('moves an Employee only to an active Company and keeps an inactive Company history readable', async () => {
    const admin = await adminCookie();
    await request(app.getHttpServer())
      .patch(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', admin)
      .send({ companyId: inactiveCompanyId })
      .expect(400);
    const moved = await request(app.getHttpServer())
      .patch(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', admin)
      .send({ companyId: northstarId })
      .expect(200);
    assert.equal(moved.body.company.id, northstarId);

    await prisma.company.update({ where: { id: northstarId }, data: { isActive: false } });
    const read = await request(app.getHttpServer())
      .get(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(read.body.company.isActive, false);
    await request(app.getHttpServer())
      .patch(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/employees/${createdEmployeeId}`)
      .set('Cookie', admin)
      .send({ isActive: true })
      .expect(400);
    await prisma.company.update({ where: { id: northstarId }, data: { isActive: true } });
  });

  it('assigns, replaces, and protects a Company owner', async () => {
    const admin = await adminCookie();
    const owner = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'primary-owner@example.test' }))
      .expect(201);
    const replacement = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'replacement-owner@example.test' }))
      .expect(201);
    const otherCompanyEmployee = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ companyId: northstarId, email: 'other-company@example.test' }))
      .expect(201);
    const inactiveEmployee = await request(app.getHttpServer())
      .post('/api/employees')
      .set('Cookie', admin)
      .send(employeePayload({ email: 'inactive-owner@example.test' }))
      .expect(201);
    await request(app.getHttpServer())
      .patch(`/api/employees/${inactiveEmployee.body.id as string}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(200);

    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}`)
      .set('Cookie', admin)
      .send({ ownerEmployeeId: owner.body.id })
      .expect(200);
    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}`)
      .set('Cookie', admin)
      .send({ ownerEmployeeId: otherCompanyEmployee.body.id })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}`)
      .set('Cookie', admin)
      .send({ ownerEmployeeId: inactiveEmployee.body.id })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}`)
      .set('Cookie', admin)
      .send({ ownerEmployeeId: null })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/employees/${owner.body.id as string}`)
      .set('Cookie', admin)
      .send({ isActive: false })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/employees/${owner.body.id as string}`)
      .set('Cookie', admin)
      .send({ companyId: northstarId })
      .expect(400);
    await request(app.getHttpServer())
      .patch(`/api/companies/${acmeId}`)
      .set('Cookie', admin)
      .send({ ownerEmployeeId: replacement.body.id })
      .expect(200);
    const detail = await request(app.getHttpServer())
      .get(`/api/employees/${replacement.body.id as string}`)
      .set('Cookie', admin)
      .expect(200);
    assert.equal(detail.body.isCompanyOwner, true);
  });

  it('lists Employees by search, Company, active state, and pagination', async () => {
    const response = await request(app.getHttpServer())
      .get(`/api/employees?search=primary-owner%40example.test&companyId=${acmeId}&isActive=true&page=1&pageSize=1`)
      .set('Cookie', await adminCookie())
      .expect(200);
    assert.equal(response.body.page, 1);
    assert.equal(response.body.pageSize, 1);
    assert.equal(response.body.total, 1);
    assert.equal(response.body.items[0].email, 'primary-owner@example.test');
    assert.equal(response.body.items[0].company.id, acmeId);
  });

  async function createTestCompany(label: string, isActive: boolean): Promise<string> {
    const company = await prisma.company.create({
      data: {
        name: `${prefix} ${label}`,
        normalizedName: `${prefix} ${label}`.toLowerCase(),
        billingContactName: 'Test Accounts',
        billingContactEmail: `${label}@employees-test.example`,
        defaultPackaging: 'Standard boxed meal',
        isActive,
        emailDomains: { create: { domain: `${label}.employees-test.example` } },
        addresses: {
          create: {
            label: 'Main Office',
            addressLine1: '1 Test Road',
            city: 'Ahmedabad',
            stateRegion: 'Gujarat',
            postalCode: '380001',
            country: 'India',
          },
        },
      },
      select: { id: true },
    });
    return company.id;
  }

  async function removeTestData(): Promise<void> {
    const companies = await prisma.company.findMany({
      where: { name: { startsWith: `${prefix} ` } },
      select: { id: true },
    });
    const companyIds = companies.map((company) => company.id);
    if (companyIds.length > 0) {
      await prisma.company.updateMany({
        where: { id: { in: companyIds } },
        data: { ownerEmployeeId: null },
      });
      await prisma.employee.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.companyAddress.deleteMany({ where: { companyId: { in: companyIds } } });
      await prisma.company.deleteMany({ where: { id: { in: companyIds } } });
    }
    await prisma.allergen.deleteMany({
      where: { normalizedName: `${prefix} Inactive Allergen`.toLowerCase() },
    });
    await prisma.dietaryTag.deleteMany({
      where: { normalizedName: `${prefix} Inactive Dietary Tag`.toLowerCase() },
    });
  }
});
