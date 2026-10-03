import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import { Controller, Get, INestApplication, UseGuards } from '@nestjs/common';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { Test } from '@nestjs/testing';
import * as cookieParser from 'cookie-parser';
import * as request from 'supertest';

import { CurrentStaff } from '../src/auth/decorators/current-staff.decorator';
import { JwtAuthGuard, SESSION_COOKIE_NAME } from '../src/auth/guards/jwt-auth.guard';
import type { AuthenticatedStaff } from '../src/auth/types/authenticated-staff.type';
import { AuthorizationModule } from '../src/authorization/authorization.module';
import { RequirePermissions } from '../src/authorization/decorators/require-permissions.decorator';
import { PermissionsGuard } from '../src/authorization/guards/permissions.guard';
import { PermissionCode } from '../src/authorization/permission-code';
import { PrismaModule } from '../src/prisma/prisma.module';
import { PrismaService } from '../src/prisma/prisma.service';

@Controller('authorization-test')
@UseGuards(JwtAuthGuard, PermissionsGuard)
class AuthorizationTestController {
  @Get('admin')
  @RequirePermissions(PermissionCode.STAFF_MANAGE)
  admin(@CurrentStaff() staffUser: AuthenticatedStaff) {
    return { email: staffUser.email };
  }

  @Get('kitchen')
  @RequirePermissions(PermissionCode.KITCHEN_UPDATE)
  kitchen() {
    return { ok: true };
  }

  @Get('catalogue')
  @RequirePermissions(PermissionCode.CATALOGUE_WRITE)
  catalogue() {
    return { ok: true };
  }

  @Get('driver')
  @RequirePermissions(PermissionCode.DELIVERY_OWN_UPDATE)
  driver() {
    return { ok: true };
  }

  @Get('all')
  @RequirePermissions(PermissionCode.ORDER_READ, PermissionCode.KITCHEN_UPDATE)
  allPermissions() {
    return { ok: true };
  }
}

describe('permission authorization', () => {
  let app: INestApplication;
  let jwtService: JwtService;
  let prisma: PrismaService;

  before(async () => {
    assert.ok(process.env.DATABASE_URL, 'DATABASE_URL is required for this test.');
    process.env.JWT_SECRET = 'authorization-integration-test-secret';

    const moduleRef = await Test.createTestingModule({
      imports: [
        PrismaModule,
        AuthorizationModule,
        JwtModule.register({ secret: process.env.JWT_SECRET }),
      ],
      controllers: [AuthorizationTestController],
      providers: [JwtAuthGuard],
    }).compile();

    app = moduleRef.createNestApplication();
    app.use(cookieParser());
    await app.init();
    jwtService = moduleRef.get(JwtService);
    prisma = moduleRef.get(PrismaService);
  });

  after(async () => {
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

  it('allows ADMIN with STAFF_MANAGE', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/admin')
      .set('Cookie', await cookieFor('admin@test.com'))
      .expect(200);
  });

  it('allows KITCHEN with KITCHEN_UPDATE', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/kitchen')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(200);
  });

  it('rejects KITCHEN without CATALOGUE_WRITE', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/catalogue')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(403);
  });

  it('allows DRIVER with DELIVERY_OWN_UPDATE at the permission layer', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/driver')
      .set('Cookie', await cookieFor('driver@test.com'))
      .expect(200);
  });

  it('returns 401 without authentication', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/kitchen')
      .expect(401);
  });

  it('requires every declared permission', async () => {
    await request(app.getHttpServer())
      .get('/authorization-test/all')
      .set('Cookie', await cookieFor('kitchen@test.com'))
      .expect(200);

    await request(app.getHttpServer())
      .get('/authorization-test/all')
      .set('Cookie', await cookieFor('dispatch@test.com'))
      .expect(403);
  });

  it('uses changed database permissions with an existing JWT', async () => {
    const kitchenCookie = await cookieFor('kitchen@test.com');
    const kitchen = await prisma.staffUser.findUniqueOrThrow({
      where: { email: 'kitchen@test.com' },
      select: { roleId: true },
    });
    const permission = await prisma.permission.findUniqueOrThrow({
      where: { code: PermissionCode.KITCHEN_UPDATE },
      select: { id: true },
    });

    await prisma.rolePermission.delete({
      where: {
        roleId_permissionId: {
          roleId: kitchen.roleId,
          permissionId: permission.id,
        },
      },
    });

    try {
      await request(app.getHttpServer())
        .get('/authorization-test/kitchen')
        .set('Cookie', kitchenCookie)
        .expect(403);
    } finally {
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: {
            roleId: kitchen.roleId,
            permissionId: permission.id,
          },
        },
        update: {},
        create: {
          roleId: kitchen.roleId,
          permissionId: permission.id,
        },
      });
    }
  });
});
