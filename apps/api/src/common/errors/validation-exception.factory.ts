import { BadRequestException } from '@nestjs/common';
import type { ValidationError } from 'class-validator';

import { ApiErrorCode } from './api-error-code';
import type { ApiErrorDetail } from './api-error-response';

export function createValidationException(
  validationErrors: ValidationError[],
): BadRequestException {
  return new BadRequestException({
    code: ApiErrorCode.VALIDATION_ERROR,
    message: 'Some fields are invalid',
    details: toValidationDetails(validationErrors),
  });
}

function toValidationDetails(
  validationErrors: ValidationError[],
  parentField?: string,
): ApiErrorDetail[] {
  return validationErrors.flatMap((validationError) => {
    const field = parentField
      ? `${parentField}.${validationError.property}`
      : validationError.property;
    const ownDetails = Object.values(validationError.constraints ?? {}).map(
      (message) => ({ field, message }),
    );

    return [
      ...ownDetails,
      ...toValidationDetails(validationError.children ?? [], field),
    ];
  });
}
