import * as assert from 'node:assert/strict';
import { after, before, beforeEach, describe, it } from 'node:test';

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
import { dispatchGroupingKey } from '../src/dispatch/dispatch-grouping.util';
import { PrismaService } from '../src/prisma/prisma.service';

const readyOrderId = '00000000-0000-4000-8000-000000000091';
const startedOrderId = '00000000-0000-4000-8000-000000000092';
const pendingOrderId = '00000000-0000-4000-8000-000000000093';

describe('dispatch module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let readyDropId: string;
  let waitingDropId: string;
  let driverId: string;
  let readyCombinationId: string;
  let startedCombinationId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'dispatch-integration-test-secret'; process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException })); app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
    prisma = moduleRef.get(PrismaService); jwtService = moduleRef.get(JwtService);
    const [ready, waiting, driver] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: readyOrderId }, select: { dispatchDropId: true } }),
      prisma.order.findUniqueOrThrow({ where: { id: startedOrderId }, select: { dispatchDropId: true } }),
      prisma.staffUser.findUniqueOrThrow({ where: { email: 'driver@test.com' } }),
    ]);
    readyDropId = ready.dispatchDropId!; waitingDropId = waiting.dispatchDropId!; driverId = driver.id;
    readyCombinationId = (await prisma.orderCombination.findFirstOrThrow({ where: { orderLine: { orderId: readyOrderId } } })).id;
    startedCombinationId = (await prisma.orderCombination.findFirstOrThrow({ where: { orderLine: { orderId: startedOrderId } } })).id;
  });
  beforeEach(async () => {
    await prisma.order.updateMany({ where: { id: { in: [readyOrderId, startedOrderId] } }, data: { status: 'CONFIRMED' } });
    await prisma.orderCombination.update({ where: { id: readyCombinationId }, data: { kitchenStartedAt: new Date(), kitchenCompletedAt: new Date() } });
    await prisma.orderCombination.update({ where: { id: startedCombinationId }, data: { kitchenStartedAt: new Date(), kitchenCompletedAt: null } });
    await prisma.dispatchDrop.update({ where: { id: readyDropId }, data: { assignedDriverId: driverId, status: 'DISPATCH_READY', dispatchReadyAt: new Date(), outForDeliveryAt: null, deliveredAt: null, wasOnTime: null } });
    await prisma.dispatchDrop.update({ where: { id: waitingDropId }, data: { assignedDriverId: null, status: 'DISPATCH_READY', dispatchReadyAt: new Date(), outForDeliveryAt: null, deliveredAt: null, wasOnTime: null } });
  });
  after(async () => { await app.close(); });
  async function cookie(email = 'dispatch@test.com') { const user = await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } }); return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`; }
  const today = () => DateTime.now().setZone('Asia/Kolkata').toISODate()!;

  it('generates an exact, normalized grouping key from historical delivery snapshots', () => {
    const base = { companyId: '00000000-0000-4000-8000-000000000001', deliveryDate: new Date('2026-10-04T00:00:00.000Z'), deliveryTimeMinutes: 780, deliveryAddressLabel: ' Main Office ', deliveryAddressLine1: ' 42 Fernleaf Road ', deliveryAddressLine2: null, deliveryCity: 'Mumbai', deliveryStateRegion: 'Maharashtra', deliveryPostalCode: '400001', deliveryCountry: 'IN' };
    assert.equal(dispatchGroupingKey(base), dispatchGroupingKey({ ...base, deliveryAddressLabel: 'main  office', deliveryAddressLine1: '42 fernleaf road' }));
    assert.notEqual(dispatchGroupingKey(base), dispatchGroupingKey({ ...base, companyId: '00000000-0000-4000-8000-000000000002' }));
    assert.notEqual(dispatchGroupingKey(base), dispatchGroupingKey({ ...base, deliveryTimeMinutes: 781 }));
    assert.notEqual(dispatchGroupingKey(base), dispatchGroupingKey({ ...base, deliveryAddressLine1: '43 Fernleaf Road' }));
  });

  it('lists grouped Drops and driver-only today work', async () => {
    const board = await request(app.getHttpServer()).get(`/api/dispatch/board?deliveryDate=${today()}`).set('Cookie', await cookie()).expect(200);
    const readyDrop = board.body.find((drop: { id: string }) => drop.id === readyDropId);
    assert.ok(readyDrop); assert.equal(readyDrop.assignedDriver.id, driverId);
    const driver = await request(app.getHttpServer()).get('/api/driver/drops/today').set('Cookie', await cookie('driver@test.com')).expect(200);
    assert.ok(driver.body.some((drop: { id: string }) => drop.id === readyDropId));
  });

  it('rejects an inactive driver assignment', async () => {
    await prisma.staffUser.update({ where: { id: driverId }, data: { isActive: false } });
    try {
      await request(app.getHttpServer()).patch(`/api/dispatch/drops/${readyDropId}/driver`).set('Cookie', await cookie()).send({ driverId }).expect(409);
    } finally {
      await prisma.staffUser.update({ where: { id: driverId }, data: { isActive: true } });
    }
  });

  it('requires kitchen readiness and permits exactly one concurrent dispatch-ready transition', async () => {
    await prisma.dispatchDrop.update({ where: { id: waitingDropId }, data: { assignedDriverId: driverId, status: 'WAITING_KITCHEN', dispatchReadyAt: null } });
    const dispatchCookie = await cookie();
    await request(app.getHttpServer()).post(`/api/dispatch/drops/${waitingDropId}/dispatch-ready`).set('Cookie', dispatchCookie).expect(409);
    await prisma.orderCombination.update({ where: { id: startedCombinationId }, data: { kitchenCompletedAt: new Date() } });
    const responses = await Promise.all([
      request(app.getHttpServer()).post(`/api/dispatch/drops/${waitingDropId}/dispatch-ready`).set('Cookie', dispatchCookie),
      request(app.getHttpServer()).post(`/api/dispatch/drops/${waitingDropId}/dispatch-ready`).set('Cookie', dispatchCookie),
    ]);
    assert.deepEqual(responses.map((response) => response.status).sort(), [201, 409]);
  });

  it('requires a valid driver before departure and transitions delivered Orders', async () => {
    await request(app.getHttpServer()).post(`/api/dispatch/drops/${waitingDropId}/out-for-delivery`).set('Cookie', await cookie()).expect(409);
    await request(app.getHttpServer()).post(`/api/dispatch/drops/${readyDropId}/out-for-delivery`).set('Cookie', await cookie()).expect(201);
    await request(app.getHttpServer()).post(`/api/dispatch/drops/${readyDropId}/out-for-delivery`).set('Cookie', await cookie()).expect(409);
    await request(app.getHttpServer()).post(`/api/driver/drops/${readyDropId}/deliver`).set('Cookie', await cookie('kitchen@test.com')).expect(403);
    await request(app.getHttpServer()).post(`/api/driver/drops/${readyDropId}/deliver`).set('Cookie', await cookie('admin@test.com')).expect(409);
    const delivered = await request(app.getHttpServer()).post(`/api/driver/drops/${readyDropId}/deliver`).set('Cookie', await cookie('driver@test.com')).send({ note: 'Delivered to reception.' }).expect(201);
    assert.equal(delivered.body.wasOnTime, Date.parse(delivered.body.deliveredAt) <= Date.parse(delivered.body.plannedDeliveryAt));
    await request(app.getHttpServer()).post(`/api/driver/drops/${readyDropId}/deliver`).set('Cookie', await cookie('driver@test.com')).expect(409);
    const order = await prisma.order.findUniqueOrThrow({ where: { id: readyOrderId }, include: { statusEvents: true } });
    assert.equal(order.status, 'DELIVERED'); assert.ok(order.statusEvents.some((event) => event.toStatus === 'DELIVERED'));
  });

  it('detaches a confirmed Order from its non-departed Drop when it is cancelled', async () => {
    const pending = await prisma.order.findUniqueOrThrow({ where: { id: pendingOrderId }, select: { dispatchDropId: true } });
    assert.ok(pending.dispatchDropId);
    await prisma.order.update({ where: { id: pendingOrderId }, data: { status: 'CONFIRMED' } });
    await prisma.dispatchDrop.update({ where: { id: pending.dispatchDropId }, data: { status: 'WAITING_KITCHEN', outForDeliveryAt: null, deliveredAt: null } });
    await request(app.getHttpServer()).post(`/api/orders/${pendingOrderId}/cancel`).set('Cookie', await cookie('admin@test.com')).expect(201);
    const cancelled = await prisma.order.findUniqueOrThrow({ where: { id: pendingOrderId }, select: { status: true, dispatchDropId: true } });
    assert.equal(cancelled.status, 'CANCELLED'); assert.equal(cancelled.dispatchDropId, null);
    assert.equal(await prisma.dispatchDrop.findUnique({ where: { id: pending.dispatchDropId } }), null);
  });

  it('regroups logistics changes before departure, ignores packaging for grouping, and blocks execution-time changes', async () => {
    const original = await prisma.order.findUniqueOrThrow({ where: { id: startedOrderId }, select: { dispatchDropId: true } });
    await request(app.getHttpServer()).patch(`/api/orders/${startedOrderId}/delivery`).set('Cookie', await cookie('admin@test.com')).send({ deliveryTime: '16:30' }).expect(200);
    const regrouped = await prisma.order.findUniqueOrThrow({ where: { id: startedOrderId }, select: { dispatchDropId: true } });
    assert.ok(regrouped.dispatchDropId); assert.notEqual(regrouped.dispatchDropId, original.dispatchDropId);
    await request(app.getHttpServer()).patch(`/api/orders/${startedOrderId}/delivery`).set('Cookie', await cookie('admin@test.com')).send({ packaging: 'Compostable tray' }).expect(200);
    const packagingOnly = await prisma.order.findUniqueOrThrow({ where: { id: startedOrderId }, select: { dispatchDropId: true } });
    assert.equal(packagingOnly.dispatchDropId, regrouped.dispatchDropId);
    await prisma.dispatchDrop.update({ where: { id: regrouped.dispatchDropId! }, data: { status: 'OUT_FOR_DELIVERY', assignedDriverId: driverId, outForDeliveryAt: new Date() } });
    await request(app.getHttpServer()).patch(`/api/orders/${startedOrderId}/delivery`).set('Cookie', await cookie('admin@test.com')).send({ deliveryTime: '17:00' }).expect(409);
    await request(app.getHttpServer()).post(`/api/orders/${startedOrderId}/cancel`).set('Cookie', await cookie('admin@test.com')).expect(409);
  });
});
