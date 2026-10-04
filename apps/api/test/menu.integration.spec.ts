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

describe('menu module', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let jwtService: JwtService;
  let acmeEmployeeId: string;
  let acmeId: string;
  let bowlsId: string;
  let secretId: string;
  let saladItemId: string;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'menu-integration-test-secret';
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
    const acme = await prisma.companyEmailDomain.findUniqueOrThrow({
      where: { domain: 'acme.com' },
      select: {
        company: {
          select: {
            id: true,
            employees: { where: { email: 'rahul@acme.com' }, select: { id: true } },
          },
        },
      },
    });
    acmeId = acme.company.id;
    acmeEmployeeId = acme.company.employees[0]?.id ?? (() => { throw new Error('Seeded Acme Employee missing.'); })();
    const [bowls, secret, salad] = await Promise.all([
      prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: 'bowls' } }),
      prisma.menuCategory.findUniqueOrThrow({ where: { normalizedName: 'chef specials' } }),
      prisma.menuCategoryItem.findFirstOrThrow({ where: { category: { normalizedName: 'salads' } } }),
    ]);
    bowlsId = bowls.id;
    secretId = secret.id;
    saladItemId = salad.id;
  });

  after(async () => { await app.close(); });

  async function cookie(email = 'admin@test.com') {
    const user = await prisma.staffUser.findUniqueOrThrow({ where: { email }, select: { id: true } });
    return `${SESSION_COOKIE_NAME}=${await jwtService.signAsync({ sub: user.id })}`;
  }

  it('enforces menu permissions', async () => {
    await request(app.getHttpServer()).get('/api/menu/categories').expect(401);
    await request(app.getHttpServer()).get('/api/menu/categories').set('Cookie', await cookie('kitchen@test.com')).expect(403);
  });

  it('hides Company-specific placements, preserves ordering, and keeps secret Categories out of normal preview', async () => {
    const preview = await request(app.getHttpServer()).get(`/api/menu/preview/employees/${acmeEmployeeId}`).set('Cookie', await cookie()).expect(200);
    assert.deepEqual(preview.body.categories.map((category: { id: string }) => category.id), [bowlsId]);
    assert.equal(preview.body.categories[0].items[0].dish.sku, 'PPB-001');
    assert.equal(preview.body.categories.some((category: { id: string }) => category.id === secretId), false);
    assert.equal(preview.body.categories.some((category: { items: Array<{ menuItemId: string }> }) => category.items.some((item) => item.menuItemId === saladItemId)), false);
  });

  it('allows visible secret Categories only through direct preview', async () => {
    const preview = await request(app.getHttpServer()).get(`/api/menu/preview/employees/${acmeEmployeeId}/categories/${secretId}`).set('Cookie', await cookie()).expect(200);
    assert.equal(preview.body.category.id, secretId);
    assert.equal(preview.body.category.items.length, 1);
  });

  it('replaces Company hiding atomically', async () => {
    const admin = await cookie();
    await request(app.getHttpServer()).put(`/api/companies/${acmeId}/menu-hiding`).set('Cookie', admin).send({ categoryIds: [bowlsId], menuItemIds: [saladItemId] }).expect(200);
    const hidden = await request(app.getHttpServer()).get(`/api/menu/preview/employees/${acmeEmployeeId}`).set('Cookie', admin).expect(200);
    assert.equal(hidden.body.categories.length, 0);
    await request(app.getHttpServer()).put(`/api/companies/${acmeId}/menu-hiding`).set('Cookie', admin).send({ categoryIds: [bowlsId, bowlsId], menuItemIds: [] }).expect(400);
    const unchanged = await request(app.getHttpServer()).get(`/api/menu/preview/employees/${acmeEmployeeId}`).set('Cookie', admin).expect(200);
    assert.equal(unchanged.body.categories.length, 0);
    await request(app.getHttpServer()).put(`/api/companies/${acmeId}/menu-hiding`).set('Cookie', admin).send({ categoryIds: [], menuItemIds: [saladItemId] }).expect(200);
  });
});
