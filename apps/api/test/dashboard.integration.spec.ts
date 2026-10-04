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
import { PrismaService } from '../src/prisma/prisma.service';

const readyOrderId = '00000000-0000-4000-8000-000000000091';
const startedOrderId = '00000000-0000-4000-8000-000000000092';
const pendingOrderId = '00000000-0000-4000-8000-000000000093';

describe('dashboard module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'dashboard-integration-test-secret'; process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException })); app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
    prisma = moduleRef.get(PrismaService); jwtService = moduleRef.get(JwtService);
  });
  beforeEach(async () => { await prisma.order.updateMany({ where: { id: { in: [readyOrderId, startedOrderId, pendingOrderId] } }, data: { status: 'CONFIRMED', invoiceId: null } }); });
  after(async () => { await app.close(); });
  async function cookie(email = 'admin@test.com') { const user = await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } }); return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`; }

  it('enforces dashboard permissions and uses the Kitchen timezone for today', async () => {
    await request(app.getHttpServer()).get('/api/dashboard/admin').expect(401);
    await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', await cookie('kitchen@test.com')).expect(403);
    const admin = await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', await cookie()).expect(200);
    assert.equal(admin.body.today, DateTime.now().setZone('Asia/Kolkata').toISODate());
  });

  it('calculates Admin, Kitchen, and Dispatch operational summaries from current data', async () => {
    const admin = await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', await cookie()).expect(200);
    assert.ok(admin.body.ordersByStatus.CONFIRMED >= 3);
    assert.ok(admin.body.todayConfirmedOrderValue > 0);
    assert.ok(admin.body.todayUninvoicedBillableValue > 0);
    const kitchen = await request(app.getHttpServer()).get('/api/dashboard/kitchen').set('Cookie', await cookie('kitchen@test.com')).expect(200);
    assert.ok(kitchen.body.prepUnitCounts.total >= 3);
    assert.ok(kitchen.body.stationBreakdown.length > 0);
    const dispatch = await request(app.getHttpServer()).get('/api/dashboard/dispatch').set('Cookie', await cookie('dispatch@test.com')).expect(200);
    assert.ok(dispatch.body.dropsByStatus.WAITING_KITCHEN + dispatch.body.dropsByStatus.DISPATCH_READY >= 1);
  });

  it('excludes a Cancelled Order from confirmed and uninvoiced value totals', async () => {
    const before = await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', await cookie()).expect(200);
    const pending = await prisma.order.findUniqueOrThrow({ where: { id: pendingOrderId }, select: { totalMinorUnits: true } });
    await prisma.order.update({ where: { id: pendingOrderId }, data: { status: 'CANCELLED' } });
    const afterSummary = await request(app.getHttpServer()).get('/api/dashboard/admin').set('Cookie', await cookie()).expect(200);
    assert.equal(afterSummary.body.todayConfirmedOrderValue, before.body.todayConfirmedOrderValue - pending.totalMinorUnits);
    assert.equal(afterSummary.body.todayUninvoicedBillableValue, before.body.todayUninvoicedBillableValue - pending.totalMinorUnits);
  });

  it('returns only the authenticated Driver’s Drops', async () => {
    const driver = await request(app.getHttpServer()).get('/api/dashboard/driver').set('Cookie', await cookie('driver@test.com')).expect(200);
    assert.ok(driver.body.totalDropCount > 0);
    const other = await request(app.getHttpServer()).get('/api/dashboard/driver').set('Cookie', await cookie()).expect(200);
    assert.equal(other.body.totalDropCount, 0);
  });
});
