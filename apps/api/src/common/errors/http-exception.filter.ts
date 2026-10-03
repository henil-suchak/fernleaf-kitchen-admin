import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
} from '@nestjs/common';
import type { Request, Response } from 'express';

import { ApiErrorCode, type ApiErrorCode as ApiErrorCodeValue } from './api-error-code';
import type { ApiErrorDetail, ApiErrorResponse } from './api-error-response';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const context = host.switchToHttp();
    const response = context.getResponse<Response>();
    const request = context.getRequest<Request>();
    const normalized = normalizeException(exception);

    const body: ApiErrorResponse = {
      statusCode: normalized.statusCode,
      code: normalized.code,
      message: normalized.message,
      path: request.originalUrl ?? request.url,
      timestamp: new Date().toISOString(),
    };

    if (normalized.details?.length) {
      body.details = normalized.details;
    }

    response.status(normalized.statusCode).json(body);
  }
}

interface NormalizedException {
  statusCode: number;
  code: ApiErrorCodeValue;
  message: string;
  details?: ApiErrorDetail[];
}

function normalizeException(exception: unknown): NormalizedException {
  if (!(exception instanceof HttpException)) {
    return internalError();
  }

  const statusCode = exception.getStatus();
  if (statusCode >= HttpStatus.INTERNAL_SERVER_ERROR) {
    return internalError();
  }

  const exceptionResponse = exception.getResponse();
  const responseBody = isRecord(exceptionResponse) ? exceptionResponse : undefined;
  const message =
    typeof exceptionResponse === 'string'
      ? exceptionResponse
      : typeof responseBody?.message === 'string'
        ? responseBody.message
        : defaultMessageForStatus(statusCode);

  return {
    statusCode,
    code: getErrorCode(responseBody?.code) ?? codeForStatus(statusCode),
    message,
    details: getDetails(responseBody?.details),
  };
}

function internalError(): NormalizedException {
  return {
    statusCode: HttpStatus.INTERNAL_SERVER_ERROR,
    code: ApiErrorCode.INTERNAL_ERROR,
    message: 'An unexpected error occurred',
  };
}

function codeForStatus(statusCode: number): ApiErrorCodeValue {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return ApiErrorCode.VALIDATION_ERROR;
    case HttpStatus.UNAUTHORIZED:
      return ApiErrorCode.UNAUTHORIZED;
    case HttpStatus.FORBIDDEN:
      return ApiErrorCode.FORBIDDEN;
    case HttpStatus.NOT_FOUND:
      return ApiErrorCode.NOT_FOUND;
    case HttpStatus.CONFLICT:
      return ApiErrorCode.CONFLICT;
    default:
      return ApiErrorCode.INTERNAL_ERROR;
  }
}

function defaultMessageForStatus(statusCode: number): string {
  switch (statusCode) {
    case HttpStatus.BAD_REQUEST:
      return 'Some fields are invalid';
    case HttpStatus.UNAUTHORIZED:
      return 'Unauthorized';
    case HttpStatus.FORBIDDEN:
      return 'Forbidden';
    case HttpStatus.NOT_FOUND:
      return 'Not found';
    case HttpStatus.CONFLICT:
      return 'Conflict';
    default:
      return 'An unexpected error occurred';
  }
}

function getErrorCode(value: unknown): ApiErrorCodeValue | undefined {
  return Object.values(ApiErrorCode).includes(value as ApiErrorCodeValue)
    ? (value as ApiErrorCodeValue)
    : undefined;
}

function getDetails(value: unknown): ApiErrorDetail[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }

  return value.filter(
    (detail): detail is ApiErrorDetail =>
      isRecord(detail) &&
      typeof detail.field === 'string' &&
      typeof detail.message === 'string',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}
