import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { ApiErrorCode } from '../common/errors/api-error-code';

export function employeeValidationError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_ERROR,
    message: 'Some fields are invalid',
    details: [{ field, message }],
  });
}

export function employeeBusinessRuleError(field: string, message: string): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.BUSINESS_RULE_VIOLATION,
    message,
    details: [{ field, message }],
  });
}

export function mapEmployeePrismaError(error: unknown): Error {
  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    if (error.code === 'P2002') return new ConflictException('An Employee with this email already exists for the Company.');
    if (error.code === 'P2025') return new NotFoundException('Employee not found.');
    if (error.code === 'P2034') return new ConflictException('The Employee update conflicted. Please retry.');
  }
  return error instanceof Error ? error : new Error('Unexpected Employee error.');
}
