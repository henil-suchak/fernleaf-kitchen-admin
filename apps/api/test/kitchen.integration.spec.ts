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
import { kitchenRisk } from '../src/common/time/order-planning.util';
import { PrismaService } from '../src/prisma/prisma.service';

const readyOrderId = '00000000-0000-4000-8000-000000000091';
const pendingOrderId = '00000000-0000-4000-8000-000000000093';
const startedOrderId = '00000000-0000-4000-8000-000000000092';

describe('kitchen module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let pendingCombinationId: string;
  let startedCombinationId: string;
  let pendingLineId: string;
  let stationId: string;
  let stationName: string | null;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'kitchen-integration-test-secret';
    process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
    prisma = moduleRef.get(PrismaService); jwtService = moduleRef.get(JwtService);
    const pendingCombination = await prisma.orderCombination.findFirstOrThrow({ where: { orderLine: { orderId: pendingOrderId } }, include: { orderLine: true } });
    pendingCombinationId = pendingCombination.id;
    pendingLineId = pendingCombination.orderLineId;
    stationId = pendingCombination.orderLine.kitchenStationId!;
    stationName = pendingCombination.orderLine.kitchenStationNameSnapshot;
    startedCombinationId = (await prisma.orderCombination.findFirstOrThrow({ where: { orderLine: { orderId: startedOrderId } } })).id;
  });
  beforeEach(async () => {
    await prisma.order.updateMany({ where: { id: { in: [readyOrderId, pendingOrderId, startedOrderId] } }, data: { status: 'CONFIRMED' } });
    await prisma.orderCombination.update({ where: { id: pendingCombinationId }, data: { kitchenStartedAt: null, kitchenCompletedAt: null } });
    await prisma.orderCombination.update({ where: { id: startedCombinationId }, data: { kitchenStartedAt: new Date(), kitchenCompletedAt: null } });
    await prisma.orderLine.update({ where: { id: pendingLineId }, data: { kitchenStationId: stationId, kitchenStationNameSnapshot: stationName } });
  });
  after(async () => { await app.close(); });
  async function cookie(email = 'kitchen@test.com') { const user = await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } }); return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`; }
  const today = () => DateTime.now().setZone('Asia/Kolkata').toISODate()!;

  it('shows only Confirmed combinations, uses snapshot routing, and filters by station', async () => {
    await prisma.order.update({ where: { id: readyOrderId }, data: { status: 'DRAFT' } });
    await prisma.orderLine.update({ where: { id: pendingLineId }, data: { kitchenStationId: null, kitchenStationNameSnapshot: null } });
    await request(app.getHttpServer()).get(`/api/kitchen/board?deliveryDate=${today()}`).expect(401);
    const board = await request(app.getHttpServer()).get(`/api/kitchen/board?deliveryDate=${today()}`).set('Cookie', await cookie()).expect(200);
    const pending = board.body.find((order: { id: string }) => order.id === pendingOrderId);
    assert.ok(pending); assert.equal(pending.units[0].station.name, 'Unassigned');
    assert.equal(board.body.some((order: { id: string }) => order.id === readyOrderId), false);
    assert.ok(pending.plannedKitchenReadyAt); assert.ok(pending.plannedDispatchReadyAt);
    const filtered = await request(app.getHttpServer()).get(`/api/kitchen/board?deliveryDate=${today()}&stationId=${stationId}`).set('Cookie', await cookie()).expect(200);
    assert.equal(filtered.body.some((order: { id: string }) => order.id === pendingOrderId), false);
    assert.ok(filtered.body.every((order: { units: Array<{ station: { id: string } }> }) => order.units.every((unit) => unit.station.id === stationId)));
  });

  it('starts once and rejects a duplicate start', async () => {
    await request(app.getHttpServer()).post(`/api/kitchen/units/${pendingCombinationId}/start`).set('Cookie', await cookie()).expect(201);
    await request(app.getHttpServer()).post(`/api/kitchen/units/${pendingCombinationId}/start`).set('Cookie', await cookie()).expect(409);
  });

  it('completes an unstarted unit with both timestamps and rejects repetition', async () => {
    await request(app.getHttpServer()).post(`/api/kitchen/units/${pendingCombinationId}/complete`).set('Cookie', await cookie()).expect(201);
    const unit = await prisma.orderCombination.findUniqueOrThrow({ where: { id: pendingCombinationId } });
    assert.ok(unit.kitchenStartedAt); assert.ok(unit.kitchenCompletedAt);
    await request(app.getHttpServer()).post(`/api/kitchen/units/${pendingCombinationId}/complete`).set('Cookie', await cookie()).expect(409);
  });

  it('completes an already started unit without replacing its start timestamp', async () => {
    const before = await prisma.orderCombination.findUniqueOrThrow({ where: { id: startedCombinationId } });
    await request(app.getHttpServer()).post(`/api/kitchen/units/${startedCombinationId}/complete`).set('Cookie', await cookie()).expect(201);
    const after = await prisma.orderCombination.findUniqueOrThrow({ where: { id: startedCombinationId } });
    assert.equal(after.kitchenStartedAt?.getTime(), before.kitchenStartedAt?.getTime());
    assert.ok(after.kitchenCompletedAt);
  });

  it('force-completes remaining units through override permission', async () => {
    await request(app.getHttpServer()).post(`/api/kitchen/orders/${startedOrderId}/force-complete`).set('Cookie', await cookie('admin@test.com')).expect(201);
    const unit = await prisma.orderCombination.findUniqueOrThrow({ where: { id: startedCombinationId } });
    assert.ok(unit.kitchenCompletedAt);
    const completedAt = unit.kitchenCompletedAt?.getTime();
    await request(app.getHttpServer()).post(`/api/kitchen/orders/${startedOrderId}/force-complete`).set('Cookie', await cookie('admin@test.com')).expect(201);
    const repeated = await prisma.orderCombination.findUniqueOrThrow({ where: { id: startedCombinationId } });
    assert.equal(repeated.kitchenCompletedAt?.getTime(), completedAt);
  });

  it('derives delivery plans dynamically and applies the documented kitchen-risk window', async () => {
    const order = await prisma.order.findUniqueOrThrow({ where: { id: pendingOrderId } });
    const board = await request(app.getHttpServer()).get(`/api/kitchen/board?deliveryDate=${today()}`).set('Cookie', await cookie()).expect(200);
    const pending = board.body.find((value: { id: string }) => value.id === pendingOrderId);
    assert.ok(pending);
    assert.equal(
      DateTime.fromISO(pending.plannedDeliveryAt).diff(DateTime.fromISO(pending.plannedDispatchReadyAt), 'minutes').minutes,
      order.deliveryMinutesBeforeSnapshot,
    );
    const now = new Date();
    assert.deepEqual(kitchenRisk(null, new Date(now.getTime() - 1), now), { late: true, atRisk: false });
    assert.deepEqual(kitchenRisk(null, new Date(now.getTime() + 15 * 60_000), now), { late: false, atRisk: true });
    assert.deepEqual(kitchenRisk(null, new Date(now.getTime() + 31 * 60_000), now), { late: false, atRisk: false });
  });

  it('recalculates plans from a confirmed-order delivery-time override', async () => {
    await request(app.getHttpServer()).patch(`/api/orders/${pendingOrderId}/delivery`).set('Cookie', await cookie('admin@test.com')).send({ deliveryTime: '16:00' }).expect(200);
    const board = await request(app.getHttpServer()).get(`/api/kitchen/board?deliveryDate=${today()}`).set('Cookie', await cookie()).expect(200);
    const pending = board.body.find((value: { id: string }) => value.id === pendingOrderId);
    assert.equal(DateTime.fromISO(pending.plannedDeliveryAt).setZone('Asia/Kolkata').toFormat('HH:mm'), '16:00');
  });
});
