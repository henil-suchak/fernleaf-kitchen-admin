import { ForbiddenException, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import * as cookieParser from 'cookie-parser';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';

import { AppModule } from './app.module';
import { SESSION_COOKIE_NAME } from './auth/guards/jwt-auth.guard';
import { HttpExceptionFilter } from './common/errors/http-exception.filter';
import { createValidationException } from './common/errors/validation-exception.factory';
import { getFrontendOrigins } from './config/environment.validation';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const config = app.get(ConfigService);
  const allowedOrigins = getFrontendOrigins(config);
  const isProduction = config.getOrThrow<string>('NODE_ENV') === 'production';

  app.setGlobalPrefix('api');
  app.use(helmet());
  app.use(cookieParser());
  app.use((request: Request, _response: Response, next: NextFunction) => {
    const isMutation = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(request.method);
    const hasSessionCookie = typeof request.cookies?.[SESSION_COOKIE_NAME] === 'string';

    if (!isMutation || !hasSessionCookie) {
      next();
      return;
    }

    const origin = request.get('origin');
    if ((!origin && !isProduction) || (origin !== undefined && allowedOrigins.has(origin))) {
      next();
      return;
    }

    next(new ForbiddenException('Cross-origin mutation is not allowed.'));
  });
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      exceptionFactory: createValidationException,
    }),
  );
  app.useGlobalFilters(new HttpExceptionFilter());
  app.enableCors({
    origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
      if (!origin || allowedOrigins.has(origin)) {
        callback(null, true);
        return;
      }
      callback(null, false);
    },
    credentials: true,
  });

  const port = Number(config.getOrThrow<string>('PORT'));
  await app.listen(port, '0.0.0.0');
}

void bootstrap();
