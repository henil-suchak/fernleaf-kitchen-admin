import { createParamDecorator, ExecutionContext } from '@nestjs/common';

import type {
  AuthenticatedRequest,
  AuthenticatedStaff,
} from '../types/authenticated-staff.type';

export const CurrentStaff = createParamDecorator(
  (_data: unknown, context: ExecutionContext): AuthenticatedStaff => {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    return request.staffUser as AuthenticatedStaff;
  },
);
