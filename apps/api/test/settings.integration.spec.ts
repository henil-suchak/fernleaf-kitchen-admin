import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { INestApplication, ValidationPipe } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import type { Weekday } from '@prisma/client';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';

import { AppModule } from '../src/app.module';
import { SESSION_COOKIE_NAME } from '../src/auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { createValidationException } from '../src/common/errors/validation-exception.factory';
import { PrismaService } from '../src/prisma/prisma.service';

describe('settings module', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;
  let originalSettings: {
    timezone: string;
    workingDays: Weekday[];
    cutoffWorkingDays: number;
    cutoffTimeMinutes: number;
  };

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'settings-integration-test-secret';
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

    const settings = await prisma.kitchenSettings.findUniqueOrThrow({
      where: { key: 'GLOBAL' },
    });
    originalSettings = {
      timezone: settings.timezone,
      workingDays: settings.workingDays,
      cutoffWorkingDays: settings.cutoffWorkingDays,
      cutoffTimeMinutes: settings.cutoffTimeMinutes,
    };

    await prisma.kitchenHoliday.deleteMany({
      where: { date: new Date('2099-12-25T00:00:00.000Z') },
    });
  });

  after(async () => {
    await prisma.kitchenSettings.update({
      where: { key: 'GLOBAL' },
      data: originalSettings,
    });
    await prisma.kitchenHoliday.deleteMany({
      where: { date: new Date('2099-12-25T00:00:00.000Z') },
    });
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

  it('reads the current kitchen settings', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .expect(200);

    assert.equal(typeof response.body.timezone, 'string');
    assert.ok(Array.isArray(response.body.workingDays));
    assert.equal(typeof response.body.cutoffTime, 'string');
  });

  it('updates valid settings and normalizes working-day order', async () => {
    const response = await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({
        timezone: 'Europe/London',
        workingDays: ['FRIDAY', 'MONDAY', 'WEDNESDAY'],
        cutoffWorkingDays: 0,
        cutoffTime: '09:30',
      })
      .expect(200);

    assert.deepEqual(response.body.workingDays, [
      'MONDAY',
      'WEDNESDAY',
      'FRIDAY',
    ]);
    assert.equal(response.body.cutoffWorkingDays, 0);
    assert.equal(response.body.cutoffTime, '09:30');
  });

  it('rejects empty or duplicate working days', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ workingDays: [] })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ workingDays: ['MONDAY', 'MONDAY'] })
      .expect(400);
  });

  it('rejects invalid timezone and cutoff time', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ timezone: 'not-a-timezone' })
      .expect(400);

    await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ cutoffTime: '24:00' })
      .expect(400);
  });

  it('rejects an empty settings update and an invalid calendar date', async () => {
    await request(app.getHttpServer())
      .patch('/api/settings/kitchen')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({})
      .expect(400);

    await request(app.getHttpServer())
      .post('/api/settings/kitchen/holidays')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send({ date: '2026-02-30' })
      .expect(400);
  });

  it('maps duplicate holiday dates to conflict', async () => {
    const holiday = { date: '2099-12-25', name: 'Test holiday' };

    await request(app.getHttpServer())
      .post('/api/settings/kitchen/holidays')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send(holiday)
      .expect(201);

    const response = await request(app.getHttpServer())
      .post('/api/settings/kitchen/holidays')
      .set('Cookie', await cookieFor('admin@test.com'))
      .send(holiday)
      .expect(409);

    assert.equal(response.body.code, 'CONFLICT');
  });

  it('maps a missing holiday delete to not found', async () => {
    const response = await request(app.getHttpServer())
      .delete('/api/settings/kitchen/holidays/00000000-0000-4000-8000-000000000000')
      .set('Cookie', await cookieFor('admin@test.com'))
      .expect(404);

    assert.equal(response.body.code, 'NOT_FOUND');
  });

  it('enforces settings permissions', async () => {
    await request(app.getHttpServer())
      .get('/api/settings/kitchen')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(403);
  });
});
