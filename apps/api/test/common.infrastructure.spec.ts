import * as assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';

import {
  Controller,
  ForbiddenException,
  Get,
  INestApplication,
  Query,
  UnauthorizedException,
  ValidationPipe,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import * as request from 'supertest';

import { ApiErrorCode } from '../src/common/errors/api-error-code';
import { HttpExceptionFilter } from '../src/common/errors/http-exception.filter';
import { createValidationException } from '../src/common/errors/validation-exception.factory';
import {
  assertMinorUnits,
  multiplyMinorUnits,
  roundUpToNearestFiveCents,
  sumMinorUnits,
} from '../src/common/money/money.util';
import { PaginationQueryDto } from '../src/common/pagination/pagination-query.dto';
import { toPaginationOptions } from '../src/common/pagination/pagination.util';
import {
  combineLocalDateAndTime,
  convertToTimeZone,
  nowInTimeZone,
  todayInTimeZone,
} from '../src/common/time/time.util';

@Controller('common-test')
class CommonTestController {
  @Get('pagination')
  pagination(@Query() query: PaginationQueryDto) {
    return toPaginationOptions(query);
  }

  @Get('unauthorized')
  unauthorized() {
    throw new UnauthorizedException();
  }

  @Get('forbidden')
  forbidden() {
    throw new ForbiddenException();
  }
}

describe('money utilities', () => {
  it('sums and multiplies integer minor units', () => {
    assert.equal(sumMinorUnits([1299, 250, 1]), 1550);
    assert.equal(multiplyMinorUnits(1299, 3), 3897);
  });

  it('rejects invalid minor-unit values and quantities', () => {
    assert.throws(() => assertMinorUnits(12.5));
    assert.throws(() => assertMinorUnits(-1));
    assert.throws(() => multiplyMinorUnits(100, 1.5));
  });

  it('rounds up to the nearest five cents', () => {
    assert.equal(roundUpToNearestFiveCents(210), 210);
    assert.equal(roundUpToNearestFiveCents(211), 215);
    assert.equal(roundUpToNearestFiveCents(214), 215);
    assert.equal(roundUpToNearestFiveCents(215), 215);
    assert.equal(roundUpToNearestFiveCents(216), 220);
  });
});

describe('time utilities', () => {
  it('uses the supplied IANA timezone for the current local date', () => {
    const now = nowInTimeZone('Asia/Kolkata');

    assert.equal(now.zoneName, 'Asia/Kolkata');
    assert.equal(todayInTimeZone('Asia/Kolkata'), now.toISODate());
  });

  it('handles a UTC and local-date boundary', () => {
    const localTime = convertToTimeZone(
      new Date('2026-10-03T20:00:00.000Z'),
      'Asia/Kolkata',
    );

    assert.equal(localTime.toISODate(), '2026-10-04');
    assert.equal(localTime.toFormat('HH:mm'), '01:30');
  });

  it('combines a local date, time, and timezone into the expected instant', () => {
    const dateTime = combineLocalDateAndTime(
      '2026-01-02',
      '09:30',
      'Asia/Kolkata',
    );

    assert.equal(dateTime.toUTC().toISO(), '2026-01-02T04:00:00.000Z');
  });
});

describe('pagination utilities', () => {
  it('converts one-based pages into skip and take values', () => {
    assert.deepEqual(toPaginationOptions({ page: 1, pageSize: 25 }), {
      page: 1,
      pageSize: 25,
      skip: 0,
      take: 25,
    });
    assert.deepEqual(toPaginationOptions({ page: 2, pageSize: 25 }), {
      page: 2,
      pageSize: 25,
      skip: 25,
      take: 25,
    });
  });
});

describe('global validation and error normalization', () => {
  let app: INestApplication;

  before(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [CommonTestController],
    }).compile();

    app = moduleRef.createNestApplication();
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
  });

  after(async () => {
    await app.close();
  });

  it('transforms valid pagination query values', async () => {
    const response = await request(app.getHttpServer())
      .get('/common-test/pagination?page=2&pageSize=25')
      .expect(200);

    assert.deepEqual(response.body, {
      page: 2,
      pageSize: 25,
      skip: 25,
      take: 25,
    });
  });

  it('returns a field-level validation error for a page size above the maximum', async () => {
    const response = await request(app.getHttpServer())
      .get('/common-test/pagination?pageSize=101')
      .expect(400);

    assert.equal(response.body.code, ApiErrorCode.VALIDATION_ERROR);
    assert.equal(response.body.message, 'Some fields are invalid');
    assert.equal(response.body.path, '/common-test/pagination?pageSize=101');
    assert.ok(
      response.body.details.some(
        (detail: { field: string }) => detail.field === 'pageSize',
      ),
    );
  });

  it('normalizes authentication failures as unauthorized errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/common-test/unauthorized')
      .expect(401);

    assert.equal(response.body.code, ApiErrorCode.UNAUTHORIZED);
  });

  it('normalizes authorization failures as forbidden errors', async () => {
    const response = await request(app.getHttpServer())
      .get('/common-test/forbidden')
      .expect(403);

    assert.equal(response.body.code, ApiErrorCode.FORBIDDEN);
  });
});
