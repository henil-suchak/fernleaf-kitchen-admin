import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApiErrorCode } from '../common/errors/api-error-code';

export function companyValidationError(
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_ERROR,
    message: 'Some fields are invalid',
    details: [{ field, message }],
  });
}

export function companyBusinessRuleError(
  field: string,
  message: string,
): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.BUSINESS_RULE_VIOLATION,
    message,
    details: [{ field, message }],
  });
}

export function mapCompanyPrismaError(
  error: unknown,
  duplicateMessage: string,
  missingMessage: string,
): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException(duplicateMessage);
    if (error.code === 'P2025') return new NotFoundException(missingMessage);
  }

  return error instanceof Error ? error : new Error('Unexpected Company error.');
}
