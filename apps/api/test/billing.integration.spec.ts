import * as assert from 'node:assert/strict';
import { after, afterEach, before, describe, it } from 'node:test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import { DispatchDropStatus } from '@prisma/client';
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
const invoicedOrderId = '00000000-0000-4000-8000-000000000083';

describe('billing module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let companyId: string;
  let otherCompanyId: string;
  const createdInvoiceIds: string[] = [];

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'billing-integration-test-secret'; process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication(); app.setGlobalPrefix('api'); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException })); app.useGlobalFilters(new HttpExceptionFilter()); await app.init();
    prisma = moduleRef.get(PrismaService); jwtService = moduleRef.get(JwtService);
    companyId = (await prisma.order.findUniqueOrThrow({ where: { id: readyOrderId }, select: { companyId: true } })).companyId;
    otherCompanyId = (await prisma.company.findFirstOrThrow({ where: { id: { not: companyId } }, select: { id: true } })).id;
  });
  afterEach(async () => {
    for (const invoiceId of createdInvoiceIds.splice(0)) {
      await prisma.order.updateMany({ where: { invoiceId }, data: { invoiceId: null, status: 'CONFIRMED' } });
      await prisma.invoice.deleteMany({ where: { id: invoiceId } });
    }
    const [readyOrder, driver] = await Promise.all([
      prisma.order.findUniqueOrThrow({ where: { id: readyOrderId } }),
      prisma.staffUser.findUniqueOrThrow({ where: { email: 'driver@test.com' } }),
    ]);
    const drop = await prisma.dispatchDrop.upsert({
      where: { id: '00000000-0000-4000-8000-0000000000a1' },
      update: { groupingKey: dispatchGroupingKey(readyOrder), companyId: readyOrder.companyId, deliveryDate: readyOrder.deliveryDate, deliveryTimeMinutes: readyOrder.deliveryTimeMinutes, assignedDriverId: driver.id, status: DispatchDropStatus.DISPATCH_READY, dispatchReadyAt: new Date(), outForDeliveryAt: null, deliveredAt: null, deliveryNote: null, deliveryPhotoUrl: null, wasOnTime: null },
      create: { id: '00000000-0000-4000-8000-0000000000a1', groupingKey: dispatchGroupingKey(readyOrder), companyId: readyOrder.companyId, deliveryDate: readyOrder.deliveryDate, deliveryTimeMinutes: readyOrder.deliveryTimeMinutes, assignedDriverId: driver.id, status: DispatchDropStatus.DISPATCH_READY, dispatchReadyAt: new Date() },
    });
    await prisma.order.update({ where: { id: readyOrderId }, data: { dispatchDropId: drop.id } });
  });
  after(async () => { await app.close(); });
  async function cookie() { const user = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@test.com' }, select: { id: true } }); return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`; }
  async function create(orderIds: string[]) {
    const response = await request(app.getHttpServer()).post('/api/billing/invoices').set('Cookie', await cookie()).send({ companyId, orderIds }).expect(201);
    createdInvoiceIds.push(response.body.id);
    return response.body;
  }

  it('lists only billable uninvoiced Orders for a Company', async () => {
    await request(app.getHttpServer()).get(`/api/billing/companies/${companyId}/uninvoiced-orders`).expect(401);
    const response = await request(app.getHttpServer()).get(`/api/billing/companies/${companyId}/uninvoiced-orders`).set('Cookie', await cookie()).expect(200);
    assert.ok(response.body.items.some((order: { id: string }) => order.id === readyOrderId));
    assert.equal(response.body.items.some((order: { id: string }) => order.id === invoicedOrderId), false);
  });

  it('creates a frozen same-Company Invoice with an exact integer total and rejects reuse', async () => {
    const expected = await prisma.order.findMany({ where: { id: { in: [readyOrderId, startedOrderId] } }, select: { totalMinorUnits: true } });
    const invoice = await create([readyOrderId, startedOrderId]);
    assert.equal(invoice.status, 'OPEN');
    assert.equal(invoice.totalMinorUnits, expected.reduce((sum, order) => sum + order.totalMinorUnits, 0));
    await request(app.getHttpServer()).post('/api/billing/invoices').set('Cookie', await cookie()).send({ companyId, orderIds: [readyOrderId] }).expect(409);
    await request(app.getHttpServer()).post('/api/billing/invoices').set('Cookie', await cookie()).send({ companyId: otherCompanyId, orderIds: [startedOrderId] }).expect(409);
  });

  it('marks an Invoice paid once', async () => {
    const invoice = await create([readyOrderId]);
    const paid = await request(app.getHttpServer()).post(`/api/billing/invoices/${invoice.id}/paid`).set('Cookie', await cookie()).expect(201);
    assert.equal(paid.body.status, 'PAID'); assert.ok(paid.body.paidAt);
    await request(app.getHttpServer()).post(`/api/billing/invoices/${invoice.id}/paid`).set('Cookie', await cookie()).expect(409);
  });

  it('keeps an Invoice frozen while an authorized invoiced Confirmed Order is cancelled', async () => {
    const invoice = await create([readyOrderId]);
    await request(app.getHttpServer()).post(`/api/orders/${readyOrderId}/cancel`).set('Cookie', await cookie()).expect(201);
    const stored = await prisma.invoice.findUniqueOrThrow({ where: { id: invoice.id }, include: { orders: true } });
    assert.equal(stored.totalMinorUnits, invoice.totalMinorUnits);
    assert.equal(stored.orders[0]?.status, 'CANCELLED');
    assert.equal(stored.orders[0]?.invoiceId, invoice.id);
  });
});
