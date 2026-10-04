import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DateTime } from 'luxon';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { SESSION_COOKIE_NAME } from '../src/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { createValidationException } from '../src/common/errors/validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';

describe('orders module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let employeeId: string;
  let dishId: string;
  let riceGroupId: string;
  let brownRiceId: string;
  let addressId: string;
  let createdOrderId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'orders-integration-test-secret';
    process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api');
    app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
    const company = await prisma.companyEmailDomain.findUniqueOrThrow({ where: { domain: 'northstarconsulting.com' }, select: { company: { select: { id: true, employees: { where: { email: 'maya@northstarconsulting.com' }, select: { id: true } }, addresses: { where: { isActive: true }, select: { id: true }, take: 1 } } } } });
    employeeId = company.company.employees[0]!.id;
    addressId = company.company.addresses[0]!.id;
    const [dish, group, option] = await Promise.all([
      prisma.dish.findUniqueOrThrow({ where: { sku: 'PPB-001' } }),
      prisma.optionGroup.findUniqueOrThrow({ where: { normalizedName: 'choose rice' } }),
      prisma.option.findUniqueOrThrow({ where: { normalizedName: 'brown rice' } }),
    ]);
    dishId = dish.id;
    riceGroupId = group.id;
    brownRiceId = option.id;
  });

  after(async () => { await app.close(); });

  async function cookie(email = 'admin@test.com') {
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`;
  }

  function futureDeliveryDate(): string {
    let date = DateTime.now().setZone('Asia/Kolkata').startOf('day').plus({ days: 10 });
    while (date.weekday > 5) date = date.plus({ days: 1 });
    return date.toISODate()!;
  }

  it('enforces Orders authentication and permissions', async () => {
    await request(app.getHttpServer()).get('/api/orders').expect(401);
    await request(app.getHttpServer()).get('/api/orders').set('Cookie', await cookie('driver@test.com')).expect(403);
  });

  it('creates a Draft with option, pricing, delivery, and tier snapshots', async () => {
    const response = await request(app.getHttpServer()).post('/api/orders').set('Cookie', await cookie()).send({
      employeeId,
      deliveryDate: futureDeliveryDate(),
      deliveryAddressId: addressId,
      deliveryTime: '13:15',
      packaging: 'Insulated tray',
      lines: [{ dishId, quantity: 2, combinations: [
        { quantity: 1, selections: [{ optionGroupId: riceGroupId, optionId: brownRiceId }] },
        { quantity: 1, selections: [{ optionGroupId: riceGroupId, optionId: brownRiceId }] },
      ] }],
    }).expect(400);
    assert.equal(response.body.code, 'VALIDATION_ERROR');

    const created = await request(app.getHttpServer()).post('/api/orders').set('Cookie', await cookie()).send({
      employeeId,
      deliveryDate: futureDeliveryDate(),
      deliveryAddressId: addressId,
      deliveryTime: '13:15',
      packaging: 'Insulated tray',
      lines: [{ dishId, quantity: 2, combinations: [
        { quantity: 2, selections: [{ optionGroupId: riceGroupId, optionId: brownRiceId }] },
      ] }],
    }).expect(201);
    createdOrderId = created.body.id;
    assert.equal(created.body.status, 'DRAFT');
    assert.equal(created.body.pricingTier.name, 'Standard');
    assert.equal(created.body.lines[0].combinations[0].selectedOptions[0].optionNameSnapshot, 'Brown Rice');
    assert.equal(created.body.statusEvents.length, 1);
  });

  it('does not reprice historical food when only delivery logistics change', async () => {
    const before = await request(app.getHttpServer()).get(`/api/orders/${createdOrderId}`).set('Cookie', await cookie()).expect(200);
    const after = await request(app.getHttpServer()).put(`/api/orders/${createdOrderId}`).set('Cookie', await cookie()).send({ deliveryTime: '14:00' }).expect(200);
    assert.equal(after.body.totalMinorUnits, before.body.totalMinorUnits);
    assert.equal(after.body.pricingTier.id, before.body.pricingTier.id);
    assert.equal(after.body.lines[0].dishUnitPriceMinorUnits, before.body.lines[0].dishUnitPriceMinorUnits);
    assert.equal(after.body.lines[0].combinations[0].selectedOptions[0].optionUnitPriceMinorUnits, before.body.lines[0].combinations[0].selectedOptions[0].optionUnitPriceMinorUnits);
  });

  it('places then cancels with a lifecycle event', async () => {
    await request(app.getHttpServer()).post(`/api/orders/${createdOrderId}/place`).set('Cookie', await cookie()).expect(201);
    const cancelled = await request(app.getHttpServer()).post(`/api/orders/${createdOrderId}/cancel`).set('Cookie', await cookie()).expect(201);
    assert.equal(cancelled.body.status, 'CANCELLED');
    assert.equal(cancelled.body.statusEvents.at(-1).toStatus, 'CANCELLED');
  });
});
