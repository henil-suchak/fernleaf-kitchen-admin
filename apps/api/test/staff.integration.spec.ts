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

describe('staff management module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let createdStaffId: string | undefined;
  const email = `staff-management-${Date.now()}@example.test`;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'staff-management-integration-test-secret';
    process.env.JWT_EXPIRES_IN = '8h';
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api'); app.use(cookieParser());
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true, exceptionFactory: createValidationException }));
    app.useGlobalFilters(new HttpExceptionFilter());
    await app.init();
    prisma = moduleRef.get(PrismaService);
    jwtService = moduleRef.get(JwtService);
  });

  after(async () => {
    if (createdStaffId) await prisma.staffUser.delete({ where: { id: createdStaffId } }).catch(() => undefined);
    await app.close();
  });

  async function cookie(emailAddress: string): Promise<string> {
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email: emailAddress }, select: { id: true } });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`;
  }

  it('allows only Administrators to list, create, change, and activate Staff Users', async () => {
    const adminCookie = await cookie('admin@test.com');
    await request(app.getHttpServer()).get('/api/staff').set('Cookie', await cookie('kitchen@test.com')).expect(403);
    await request(app.getHttpServer()).get('/api/staff/roles').set('Cookie', await cookie('driver@test.com')).expect(403);

    const roles = await request(app.getHttpServer()).get('/api/staff/roles').set('Cookie', adminCookie).expect(200);
    const kitchenRole = roles.body.find((role: { code: string }) => role.code === 'KITCHEN');
    const driverRole = roles.body.find((role: { code: string }) => role.code === 'DRIVER');
    assert.ok(kitchenRole); assert.ok(driverRole);

    const created = await request(app.getHttpServer()).post('/api/staff').set('Cookie', adminCookie).send({ email, password: 'SafeTemporaryPassword1!', roleId: kitchenRole.id }).expect(201);
    createdStaffId = created.body.id;
    assert.equal(created.body.email, email);
    assert.equal(created.body.passwordHash, undefined);
    assert.equal(created.body.role.code, 'KITCHEN');

    const changed = await request(app.getHttpServer()).patch(`/api/staff/${createdStaffId}`).set('Cookie', adminCookie).send({ roleId: driverRole.id, isActive: false }).expect(200);
    assert.equal(changed.body.role.code, 'DRIVER'); assert.equal(changed.body.isActive, false);

    await request(app.getHttpServer()).patch(`/api/staff/${createdStaffId}`).set('Cookie', adminCookie).send({ isActive: true }).expect(200);
    const staff = await request(app.getHttpServer()).get('/api/staff').set('Cookie', adminCookie).expect(200);
    assert.ok(staff.body.some((member: { id: string }) => member.id === createdStaffId));
  });

  it('protects the final active Administrator account', async () => {
    const admin = await prisma.staffUser.findUniqueOrThrow({ where: { email: 'admin@test.com' }, select: { id: true } });
    await request(app.getHttpServer()).patch(`/api/staff/${admin.id}`).set('Cookie', await cookie('admin@test.com')).send({ isActive: false }).expect(409);
  });
});
